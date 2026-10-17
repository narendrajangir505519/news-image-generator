
import express from "express";
import { chromium } from "playwright";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const TARGET_URL = process.env.TARGET_URL;
const SECRET = process.env.AUTOMATION_SECRET;
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 30 * 60 * 1000);

let running = false;

function isAuthorized(req) {
  return Boolean(SECRET) &&
    req.get("x-automation-secret") === SECRET;
}

app.get("/", (_req, res) => {
  res.json({
    service: "News Image Generator Automation",
    ready: Boolean(TARGET_URL && SECRET),
    running
  });
});

app.post("/run", async (req, res) => {

  if (!TARGET_URL) {
    return res.status(500).json({ error: "TARGET_URL missing" });
  }

  if (running) {
    return res.status(409).json({ error: "Automation already running" });
  }

  running = true;
  let browser;

  try {
    browser = await chromium.launch({ headless: true });

    const context = await browser.newContext();
    const page = await context.newPage();

    page.setDefaultTimeout(30000);

    console.log("Opening news image generator:", TARGET_URL);
    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });

    const generateBtn = page.locator("#generateBtn");
    const statusBox = page.locator("#statusBox");

    await generateBtn.waitFor({ state: "visible" });
    await statusBox.waitFor({ state: "visible" });

    // Track whether status leaves green after clicking.
    await page.evaluate(() => {
      const box = document.querySelector("#statusBox");
      window.__statusSawNonGreen = !isGreen(box);

      function isGreen(el) {
        if (!el) return false;

        const css = getComputedStyle(el);
        const color = css.backgroundColor;
        const match = color.match(
          /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/
        );

        const rgbGreen = match &&
          Number(match[2]) > 100 &&
          Number(match[2]) > Number(match[1]) * 1.25 &&
          Number(match[2]) > Number(match[3]) * 1.25;

        const classGreen =
          /green|success/i.test(el.className?.toString() || "");

        return Boolean(rgbGreen || classGreen);
      }

      window.__statusTimer = setInterval(() => {
        if (!isGreen(document.querySelector("#statusBox"))) {
          window.__statusSawNonGreen = true;
        }
      }, 250);
    });

    console.log("Clicking #generateBtn");
    await generateBtn.click();

    await page.waitForFunction(() => {
      const box = document.querySelector("#statusBox");
      if (!box) return false;
    
      const color = getComputedStyle(box).color;
      const match = color.match(
        /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/
      );
    
      if (!match) return false;
    
      const r = Number(match[1]);
      const g = Number(match[2]);
      const b = Number(match[3]);
    
      return g > 100 && g > r * 1.25 && g > b * 1.25;
    }, { timeout: TIMEOUT_MS });
    const statusText = await statusBox.innerText();

    console.log("SUCCESS: statusBox is green");
    console.log("Final status:", statusText);

    return res.json({
      success: true,
      message: "Green status detected; browser will close.",
      status: statusText
    });
  } catch (error) {
    console.error("Automation failed:", error.message);

    return res.status(500).json({
      success: false,
      error: error.message
    });
  } finally {
    if (browser) {
      await browser.close().catch(console.error);
      console.log("Browser closed.");
    }

    running = false;
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Automation service listening on port ${PORT}`);
});
