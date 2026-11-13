"""Equipment must become visible only after the persistence promise succeeds."""
import argparse
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:5177')
args = parser.parse_args()
assert args.url.startswith(('http://127.0.0.1:', 'http://localhost:'))
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(service_workers='block')
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(args.url + '/#/collection')
    page.wait_for_selector('[data-equip-board=club]')
    page.evaluate('''() => {
      const original = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete');
      Object.defineProperty(IDBTransaction.prototype, 'oncomplete', {
        configurable: true,
        get: original.get,
        set(callback) {
          original.set.call(this, this.mode === 'readwrite' && callback
            ? function(event) { setTimeout(() => callback.call(this, event), 1200) }
            : callback);
        }
      });
    }''')
    page.locator('[data-equip-board=club]').click()
    assert page.locator('html').get_attribute('data-board-theme') == 'current', 'Theme applied before save confirmation'
    page.wait_for_function("document.documentElement.dataset.boardTheme === 'club'")
    page.wait_for_function("document.querySelector('[data-equip-board=current]')?.disabled === false")
    page.reload()
    page.wait_for_selector('[data-equip-board=club]:disabled')
    assert page.locator('html').get_attribute('data-board-theme') == 'club'
    assert not errors, errors
    print('Equipment waits for persistence and survives immediate reload: OK; 0 JS errors')
    browser.close()
