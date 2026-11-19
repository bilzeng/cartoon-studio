"""Build clean offline ZIPs for end users. Run after npm ci and npm run build."""
import argparse
import concurrent.futures
import hashlib
import os
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HERE = ROOT / "scripts" / "portable"
TARGETS = dict((parts[0], parts[1:]) for parts in (line.split() for line in (HERE / "runtimes.tsv").read_text().splitlines()))
LABELS = {"win32":"Windows","darwin":"macOS","linux":"Linux"}

def checked_archive(url, digest, cache):
    file = cache / url.rsplit("/",1)[-1]
    if file.is_file() and hashlib.sha256(file.read_bytes()).hexdigest() == digest:
        return file
    with tempfile.NamedTemporaryFile(dir=cache, delete=False) as out:
        temp = Path(out.name)
        try:
            with urllib.request.urlopen(url, timeout=180) as response:
                shutil.copyfileobj(response,out)
            out.flush()
            if hashlib.sha256(temp.read_bytes()).hexdigest() != digest:
                raise ValueError("Checksum mismatch: " + file.name)
        except BaseException:
            out.close()
            temp.unlink(missing_ok=True)
            raise
    temp.replace(file)
    return file

def extract_member(archive, member, destination):
    with (zipfile.ZipFile(archive) if archive.suffix==".zip" else tarfile.open(archive,"r:gz")) as source:
        with (source.open(member) if isinstance(source,zipfile.ZipFile) else source.extractfile(member)) as stream, destination.open("wb") as output:
            shutil.copyfileobj(stream,output)

def package(target, base, cache, output):
    system, arch = target.split("-")
    win = system=="win32"
    extension = ".exe" if win else ""
    name = "CartoonStudio-"+LABELS[system]+"-"+arch+".zip"
    node_url, node_sha, ff_url, ff_sha = TARGETS[target]
    node = checked_archive(node_url,node_sha,cache)
    ffmpeg = checked_archive(ff_url,ff_sha,cache)
    with tempfile.TemporaryDirectory() as work:
        extra=Path(work)
        bin_dir=extra/"runtime/bin"
        notices=extra/"runtime/licenses"
        bin_dir.mkdir(parents=True)
        notices.mkdir()
        prefix=node.name.split(".tar.gz")[0].split(".zip")[0]+"/"
        extract_member(node,prefix+("node.exe" if win else "bin/node"),bin_dir/("node"+extension))
        extract_member(node,prefix+"LICENSE",notices/"Node-LICENSE.txt")
        extract_member(ffmpeg,"package/ffmpeg"+extension,bin_dir/("ffmpeg"+extension))
        extract_member(ffmpeg,"package/README.md",notices/"FFmpeg-README.md")
        extract_member(ffmpeg,"package/package.json",notices/"FFmpeg-package.json")
        (notices/"sources.txt").write_text(node_url+"\n"+ff_url+"\nhttps://github.com/ffmpeg-installer/ffmpeg-installer\nhttps://ffmpeg.org/download.html\n")
        launch={"darwin":"Start-macOS.command","linux":"Start-Linux.sh","win32":"Start-Windows.cmd"}[system]
        shutil.copy2(ROOT/launch,extra/launch)
        if not win:
            (extra/"scripts/portable").mkdir(parents=True)
            shutil.copy2(HERE/"start-unix.sh",extra/"scripts/portable")
        for tool in bin_dir.iterdir():
            tool.chmod(0o755)
        archive=output/name
        pending=archive.with_suffix(".zip.tmp")
        with zipfile.ZipFile(pending,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=3) as z:
            for tree in [base,extra]:
                for item in sorted(tree.rglob("*")):
                    if item.is_file():
                        z.write(item,"CartoonStudio/"+item.relative_to(tree).as_posix())
        pending.replace(archive)
        print(name,flush=True)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("targets",nargs="*")
    parser.add_argument("--cache",type=Path)
    parser.add_argument("--output",type=Path,default=ROOT/"releases")
    args=parser.parse_args()
    targets=args.targets or list(TARGETS)
    if set(targets)-set(TARGETS): parser.error("Supported: "+", ".join(TARGETS))
    if not (ROOT/"dist/client/index.html").is_file():parser.error("Run npm run build first")
    args.output.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory() as work:
        base=Path(work)/"app"
        base.mkdir()
        cache=args.cache or Path(work)/"downloads"
        cache.mkdir(exist_ok=True,parents=True)
        for name in ["package.json","package-lock.json"]:
            shutil.copy2(ROOT/name,base/name)
        command=shutil.which("npm.cmd" if os.name=="nt" else "npm")
        subprocess.run([command,"ci","--omit=dev","--ignore-scripts","--no-fund","--no-audit"],cwd=base,check=True)
        for directory in ["dist/client","server","shared","public"]:
            shutil.copytree(ROOT/directory,base/directory)
        shutil.copy2(HERE/"使用说明.txt",base)
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            list(pool.map(lambda target: package(target,base,cache,args.output), targets))

if __name__=="__main__": main()
