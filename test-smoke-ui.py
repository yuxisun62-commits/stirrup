from playwright.sync_api import sync_playwright
import time

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False)
    page = browser.new_page(viewport={"width": 1400, "height": 900})

    page.on("console", lambda msg: print(f"  CONSOLE [{msg.type}]: {msg.text[:150]}") if msg.type == "error" else None)

    print("Opening app...")
    page.goto("http://localhost:3710")
    page.wait_for_load_state("networkidle")
    time.sleep(1)
    page.keyboard.press("Escape")
    time.sleep(0.5)

    # Delete ALL old smoke test workflows first
    print("\nDeleting old workflows...")
    while True:
        delete_btns = page.locator("text=Engine Smoke Test").locator("xpath=..").locator("button").all()
        if not delete_btns:
            break
        try:
            page.on("dialog", lambda dialog: dialog.accept())
            delete_btns[-1].click()
            time.sleep(1)
        except:
            break

    page.screenshot(path="C:/Users/ter_w/Downloads/smoke-a-cleaned.png")
    print("Cleaned sidebar")

    # Load fresh template
    print("\nLoading fresh template...")
    page.locator("text=Templates").first.click()
    time.sleep(2)

    # Force click by evaluating JS to avoid overlay issues
    page.evaluate("""() => {
        const items = document.querySelectorAll('div');
        for (const item of items) {
            if (item.textContent.includes('Engine Smoke Test') && item.textContent.includes('All Node Types')) {
                item.click();
                break;
            }
        }
    }""")
    time.sleep(1)
    page.screenshot(path="C:/Users/ter_w/Downloads/smoke-b-template-selected.png")

    # Click Use Template via JS
    page.evaluate("""() => {
        const btns = document.querySelectorAll('button');
        for (const btn of btns) {
            if (btn.textContent.includes('Use Template') || btn.textContent.includes('Use')) {
                btn.click();
                break;
            }
        }
    }""")
    time.sleep(2)
    page.screenshot(path="C:/Users/ter_w/Downloads/smoke-c-canvas.png")
    print("Template loaded on canvas")

    # Click Run Workflow
    print("\nRunning workflow...")
    page.evaluate("""() => {
        const btns = document.querySelectorAll('button');
        for (const btn of btns) {
            if (btn.textContent.trim() === 'Run Workflow') {
                btn.click();
                break;
            }
        }
    }""")
    time.sleep(1)
    page.screenshot(path="C:/Users/ter_w/Downloads/smoke-d-run-dialog.png")

    # Click Run in dialog
    page.evaluate("""() => {
        const btns = [...document.querySelectorAll('button')];
        const runBtn = btns.filter(b => b.textContent.trim() === 'Run').pop();
        if (runBtn) runBtn.click();
    }""")
    time.sleep(2)
    page.screenshot(path="C:/Users/ter_w/Downloads/smoke-e-2s.png")
    print("2s after Run")

    time.sleep(8)
    page.screenshot(path="C:/Users/ter_w/Downloads/smoke-f-10s.png")
    print("10s after Run")

    time.sleep(20)
    page.screenshot(path="C:/Users/ter_w/Downloads/smoke-g-30s.png")
    print("30s after Run")

    time.sleep(30)
    page.screenshot(path="C:/Users/ter_w/Downloads/smoke-h-60s.png")
    print("60s after Run")

    browser.close()
