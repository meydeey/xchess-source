"""Check the production build and its service worker with a disposable player profile."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:5177')
args = parser.parse_args()
assert args.url.startswith(('http://127.0.0.1:', 'http://localhost:'))
expected = json.loads(Path(__file__).with_name('provenance.json').read_text())
with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(locale='fr-FR', viewport={'width': 390, 'height': 844})
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(args.url + '/#/collection', wait_until='domcontentloaded')
    page.wait_for_function('!!navigator.serviceWorker.controller', timeout=15000)
    page.wait_for_selector('.skin-card')
    context.set_offline(True)
    page.reload(wait_until='domcontentloaded')
    page.wait_for_selector('.skin-card')
    cached = page.evaluate("async () => { const keys = await caches.keys(); const cache = await caches.open(keys.find(x => x.startsWith('xchess-'))); return (await cache.keys()).filter(r => r.url.includes('/companion/')).length }")
    assert cached == len(expected['assets']), cached
    rendered = 0
    for skin in ['origin', 'explorer', 'code', 'twilight', 'egyptian', 'candy', 'horror']:
        page.locator(f'[data-try-rabbit={skin}]').click()
        for pose in ['idle', 'blink', 'thinking', 'joy', 'surprise', 'encouragement', 'victory']:
            if page.locator(f'.collection-pose option[value={pose}]').evaluate('option => option.disabled'):
                continue
            page.locator('.collection-pose select').select_option(pose)
            page.wait_for_function("(() => { const image = document.querySelector('.collection-companion img'); return image.complete && image.naturalWidth > 0 })()")
            rendered += 1
    assert rendered == cached, (rendered, cached)
    assert not errors, errors
    print(f'Offline activation, reload and {rendered} precached expressions: OK; 0 JS errors')
    browser.close()
