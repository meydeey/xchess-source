"""Check rabbit placement without reducing the existing board on all 8 board routes."""
import argparse
import json
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:5176')
parser.add_argument('--output', type=Path, default=Path('/tmp/xchess-companion-boards'))
args = parser.parse_args()
assert args.url.startswith(('http://127.0.0.1:', 'http://localhost:'))
args.output.mkdir(parents=True, exist_ok=True)
fixture = subprocess.check_output(['bun', str(HERE / 'build-ui-fixture.mjs')], cwd=ROOT)
results = {}
with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(service_workers='block', locale='fr-FR', viewport={'width': 390, 'height': 844})
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(args.url + '/#/settings', wait_until='networkidle')
    with page.expect_navigation(wait_until='networkidle'):
        page.locator('.backup-file').set_input_files({'name': 'isolated-fixture.json', 'mimeType': 'application/json', 'buffer': fixture})
    page.goto(args.url + '/#/collection', wait_until='networkidle')
    page.locator('[data-equip-board=code]').click()
    page.wait_for_function("document.documentElement.dataset.boardTheme === 'code'")
    for name, path in [('training', '/train/partie-italienne'), ('exploration', '/train/partie-italienne/explore'), ('stockfish', '/train/partie-italienne/explore'), ('session', '/session/go'), ('rush', '/rush'), ('exercises', '/exercises/tactics'), ('arena', '/arena'), ('games', '/games')]:
        page.goto(args.url + '/#' + path, wait_until='networkidle')
        if name == 'stockfish':
            page.locator('.x-play').click()
            page.locator('.btn-exit-play').wait_for(state='visible')
        page.locator('cg-board:visible').first.wait_for()
        page.locator('.rabbit-companion:visible').first.wait_for()
        assert page.locator('.rabbit-companion:visible').count() == 1, name
        measures = {}
        for device, width, height in [('phone', 390, 844), ('tablet-portrait', 820, 1180), ('tablet-landscape', 1180, 820)]:
            page.set_viewport_size({'width': width, 'height': height})
            page.wait_for_timeout(120)
            board = page.locator('cg-board:visible').first
            before = board.evaluate('e => e.clientWidth')
            companion = page.locator('.rabbit-companion:visible')
            companion.evaluate('e => e.hidden = true')
            page.wait_for_timeout(120)
            after = page.locator('cg-board:visible').first.evaluate('e => e.clientWidth')
            page.locator('.rabbit-companion').evaluate_all("els => els.forEach(e => e.hidden = false)")
            assert before == after and before > 200, (name, device, before, after)
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (name, device)
            measures[device] = before
            if device == 'phone':
                page.screenshot(path=str(args.output / f'{name}-{device}.png'), full_page=True)
        results[name] = measures
        print(name, measures, flush=True)
    # The PGN exercise resolves a real legal accepted move and triggers the companion only after it.
    page.locator('.games-move-select').select_option('d2d4')
    page.locator('.games-play').click()
    page.wait_for_function("document.querySelector('.rabbit-companion').dataset.pose === 'joy'")
    # Loading, checkmate and undo in the arena use verified chess.js facts.
    page.goto(args.url + '/#/arena', wait_until='networkidle')
    page.locator('.arena-fen summary').click()
    page.locator('#arena-fen-input').fill('7k/6pp/5KQ1/8/8/8/8/8 w - - 0 1')
    page.locator('.arena-load').click()
    page.locator('cg-board').scroll_into_view_if_needed()
    box = page.locator('cg-board').bounding_box()
    for file, rank in [(6, 5), (6, 6)]:
        page.mouse.click(box['x'] + (file + .5) * box['width'] / 8, box['y'] + (7 - rank + .5) * box['height'] / 8)
    page.wait_for_function("document.querySelector('.rabbit-companion').dataset.pose === 'victory'")
    assert 'mat' in page.locator('.rabbit-companion p').inner_text().lower()
    page.locator('.arena-undo').click()
    assert page.locator('.rabbit-companion p').inner_text() == ''
    assert not errors, errors
    (args.output / 'results.json').write_text(json.dumps(results, indent=2))
    print('8 board routes, stable sizes, PGN resolution and verified mate/undo: OK; 0 JS errors', flush=True)
    browser.close()
