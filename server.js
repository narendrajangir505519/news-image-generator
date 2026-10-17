
import express from "express";
import { chromium } from "playwright";
import { randomUUID } from "node:crypto";

const app = express();
app.use(express.json({ limit: "20kb" }));

const PORT = process.env.PORT || 10000;
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 30 * 60 * 1000);

let job = {
  id: null,
  state: "idle",
  message: "No job started",
  status: null,
  error: null
};

let running = false;

app.get("/", (_req, res) => {
  res.json({
    service: "News Image Generator Automation",
    ready: true,
    running,
    job
  });
});

app.get("/status", (_req, res) => {
  res.json(job);
});

app.post("/run", (req, res) => {
  const targetUrl = req.body?.url;

  if (!targetUrl) {
    return res.status(400).json({ error: "URL missing" });
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    return res.status(400).json({ error: "Invalid URL" });
  }

  // Only allow your own website.
  if (
    parsedUrl.protocol !== "https:" ||
    parsedUrl.hostname !== "viral24.in"
  ) {
    return res.status(400).json({ error: "Target URL not allowed" });
  }

  if (running) {
    return res.status(409).json({
      error: "Automation already running",
      job
    });
  }

  const id = randomUUID();

  running = true;
  job = {
    id,
    state: "running",
    message: "Browser automation started",
    status: null,
    error: null
  };

  // Return immediately. Run Playwright separately.
  res.status(202).json({
    accepted: true,
    jobId: id,
    statusUrl: "/status"
  });

  void runAutomation(targetUrl, id);
});

async function runAutomation(targetUrl, id) {
  let browser;

  try {
    browser = await chromium.launch({ headless: true });

    const context = await browser.newContext();
    const page = await context.newPage();

    page.setDefaultTimeout(60000);

    console.log("Opening:", targetUrl);

    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    const generateBtn = page.locator("#generateBtn");
    const statusBox = page.locator("#statusBox");

    await generateBtn.waitFor({ state: "visible" });
    await statusBox.waitFor({ state: "visible" });

    console.log("Clicking generate button");
    await generateBtn.click();

    // This detects a green TEXT color, matching your original
    // waitForFunction condition. Confirm this means ALL images
    // are finished in your page before relying on it.
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

    job = {
      id,
      state: "completed",
      message: "Green status detected",
      status: statusText,
      error: null
    };

    console.log("Automation completed:", statusText);
  } catch (error) {
    console.error("Automation failed:", error);

    job = {
      id,
      state: "failed",
      message: "Automation failed",
      status: null,
      error: error.message
    };
  } finally {
    if (browser) {
      await browser.close().catch(console.error);
    }

    running = false;
  }
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Automation service listening on port ${PORT}`);
});
