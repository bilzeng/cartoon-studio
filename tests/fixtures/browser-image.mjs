export async function imageFixture(page, color, mimeType = "image/png") {
  const url = await page.evaluate(({ color, mimeType }) => {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 24;
    const context = canvas.getContext("2d");
    context.fillStyle = color;
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL(mimeType);
  }, { color, mimeType });
  return Buffer.from(url.split(",")[1], "base64");
}
