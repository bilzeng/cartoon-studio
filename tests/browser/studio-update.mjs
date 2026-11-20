import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

test("工作台一键更新 main，等待生成、重启后刷新并保留项目", {timeout: 180000}, async t => {
  const base = await mkdtemp(path.join(tmpdir(), "studio-update-e2e-"));
  const source = path.join(base, "upstream"), client = path.join(base, "install");
  t.after(() => rm(base, { recursive: true, force: true }));
  const git = (cwd, ...args) => execFileSync("git", args, {cwd, encoding:"utf8", stdio:["ignore","pipe","pipe"]}).trim();
  await mkdir(source);
  for (const item of ["server","shared","src","public","worker",".openai","scripts/prepare-sites-build.mjs","vite.config.mjs",
    "package.json","package-lock.json","index.html",".gitignore"]) {
    await cp(path.resolve(item), path.join(source,item), { recursive:true });
  }
  git(source,"init","-b","main"); git(source,"config","user.name","Studio test");
  git(source,"config","user.email","studio@example.invalid");
  git(source,"add","."); git(source,"commit","-m","initial");
  git(base,"clone",source,client);
  await writeFile(path.join(client,".git/info/exclude"),"/node_modules\n");
  await symlink(path.resolve("node_modules"),path.join(client,"node_modules"),"junction");
  execFileSync(process.execPath,[path.resolve("node_modules/vite/bin/vite.js"),"build"],{cwd:client,stdio:"pipe"});
  const env={...process.env,PORT:"0",STUDIO_NO_OPEN:"1"};
  delete env.NODE_TEST_CONTEXT;
  delete env.STUDIO_DATA_DIR;
  function launch() {
    const proc=spawn(process.execPath,["server/start.mjs"],{cwd:client,env,stdio:["ignore","pipe","pipe"]});
    const address=new Promise((ok,fail)=>{
      proc.stdout.on("data",data=>{const match=String(data).match(/http:\/\/127\.0\.0\.1:\d+/);if(match)ok(match[0]);});
      proc.once("exit",()=>fail(Error("启动器退出")));
    });
    return {proc,address};
  }
  let launcher=launch();
  t.after(async()=>{if(launcher.proc.exitCode===null && launcher.proc.signalCode===null) {const exit=once(launcher.proc,"exit"); launcher.proc.kill(); await exit;}});
  const url=await launcher.address;
  const browser=await chromium.launch();
  t.after(()=>browser.close());
  const page=await browser.newPage();
  await page.goto(url);
  assert.equal((await page.request.post(url+"/_studio/update",{headers:{Origin:"https://other.invalid"},data:{}})).status(),403);
  const version=await (await page.request.get(url+"/_studio/update")).json();
  const btn=page.getByRole("button",{name:"更新并重启"});
  await btn.click();
  await page.getByRole("status").filter({hasText:"已是主分支最新版本"}).waitFor();
  const project=await (await page.request.post(url+"/api/projects",{data:{name:"更新保留的项目"}})).json();
  assert.ok(project.id);
  await writeFile(path.join(source,"public","update-fixture.txt"),"new main");
  git(source,"add","public");git(source,"commit","-m","next version");
  const id=git(source,"rev-parse","HEAD");
  // A local edit must survive the attempted update.
  const configPath=path.join(client,"index.html"), initialHtml=await readFile(configPath,"utf8");
  await writeFile(configPath,initialHtml+"<!-- local edit -->");
  await btn.click();
  await page.getByRole("status").filter({hasText:"未提交"}).waitFor();
  assert.equal(await readFile(configPath,"utf8"),initialHtml+"<!-- local edit -->");
  await writeFile(configPath,initialHtml);
  await writeFile(path.join(client,"data/jobs.json"),JSON.stringify([{id:"test-job",status:"running"}]));
  const navigations=[];page.on("framenavigated",f=>{if(f===page.mainFrame())navigations.push(f.url());});
  await btn.click();
  await page.locator(".studio-update small").filter({hasText:"等待当前任务"}).waitFor({timeout:120000});
  assert.equal(git(client,"rev-parse","HEAD"),version.version);
  await writeFile(path.join(client,"data/jobs.json"),"[]");
  await page.getByRole("status").filter({hasText:"工作室已更新至 "+id.slice(0,7)}).waitFor({timeout:30000});
  assert.ok(navigations.includes(url+"/"));
  assert.equal(await (await page.request.get(url+"/update-fixture.txt")).text(),"new main");
  assert.equal((await (await page.request.get(url+"/api/projects/"+project.id)).json()).name,"更新保留的项目");
  assert.equal(git(client,"rev-parse","HEAD"),id);
  assert.equal(git(client,"status","--porcelain"),"");
  const exit=once(launcher.proc,"exit");launcher.proc.kill();await exit;
  launcher=launch();
  const reopened=await launcher.address;
  assert.equal(await (await page.request.get(reopened+"/update-fixture.txt")).text(),"new main");
  assert.equal((await (await page.request.get(reopened+"/api/projects/"+project.id)).json()).id,project.id);
  // A candidate can build successfully and still fail while starting its server.
  await writeFile(path.join(source,"server/serve.mjs"),'throw Error("fixture startup failure");');
  git(source,"add","server");git(source,"commit","-m","broken server");
  await page.goto(reopened);
  await btn.click();
  await page.getByRole("status").filter({hasText:"启动失败"}).waitFor({timeout:120000});
  assert.equal(git(client,"rev-parse","HEAD"),id);
  assert.equal((await readFile(path.join(client,".studio/updates/active"),"utf8")).trim(),id);
  assert.equal(await (await page.request.get(reopened+"/update-fixture.txt")).text(),"new main");
  assert.equal((await (await page.request.get(reopened+"/api/projects/"+project.id)).json()).id,project.id);
});
