"""Isolated UI checks. Requires the already available Python Playwright installation."""
import argparse
import itertools
import json
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright


def run(url, output):
    assert urlparse(url).hostname in ('localhost', '127.0.0.1'), 'Local preview required'
    output.mkdir(parents=True, exist_ok=True)
    errors = []
    sizes = {}
    combinations = 0
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            context = browser.new_context(viewport={'width': 1440, 'height': 1000}, service_workers='block')
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
            page.goto(url, wait_until='networkidle')
            page.wait_for_function("document.querySelector('#board-measure').textContent.includes('référence 360')")
            frame = page.locator('#scene').element_handle().content_frame()
            reference = page.locator('#reference').element_handle().content_frame()
            assert page.locator('.rabbit-card').count() == 12
            page.locator('#gallery').scroll_into_view_if_needed()
            page.wait_for_function("[...document.querySelectorAll('.rabbit-card img')].every(i => i.complete && i.naturalWidth > 0)")
            assert frame.locator('cg-board piece').count() == 32
            initial_board = frame.locator('cg-board').element_handle()
            fingerprint = frame.locator('cg-board piece').evaluate_all("els => els.map(e => e.className + e.style.cssText).sort().join('|')")
            for style, outfit, board in itertools.product(
                ['illustration', 'figurine', 'pixel'], ['origin', 'explorer', 'code', 'twilight'],
                ['current', 'club', 'burrow', 'code', 'passage']
            ):
                for group, value in [('style', style), ('outfit', outfit), ('board', board)]:
                    page.locator(f'[data-group="{group}"][data-value="{value}"]').click()
                for reaction in ['waiting', 'good', 'error', 'hint', 'victory']:
                    page.locator(f'[data-group="reaction"][data-value="{reaction}"]').click()
                    frame.wait_for_function("expected => document.body.dataset.reaction === expected", arg=reaction)
                    frame.wait_for_function("expected => document.querySelector('#rabbit').src.endsWith(expected) && document.querySelector('#rabbit').complete", arg=f'{style}-{outfit}.png')
                    assert frame.locator('cg-board piece').evaluate_all("els => els.map(e => e.className + e.style.cssText).sort().join('|')") == fingerprint
                    assert frame.locator('body').get_attribute('class').split()[0] == f'theme-{board}'
                    assert initial_board.evaluate('e => e.isConnected'), 'Board must survive a choice change'
                    assert frame.locator('cg-board').evaluate('e => e.clientWidth') == 360
                    combinations += 1
            print(f'{combinations} combinations: same 32 pieces, stable board size, correct rabbit and reaction', flush=True)

            for device, width, expected_reference, expected_board in [('phone', 390, 360, 360), ('tablet-portrait', 820, 664, 768), ('tablet-landscape', 1180, 664, 696)]:
                page.locator(f'[data-group="device"][data-value="{device}"]').click()
                frame.wait_for_function('width => window.innerWidth === width', arg=width)
                reference.wait_for_function('width => window.innerWidth === width', arg=width)
                frame.wait_for_function("size => document.querySelector('cg-board').clientWidth === size", arg=expected_board)
                reference.wait_for_function("size => document.querySelector('cg-board').clientWidth === size", arg=expected_reference)
                actual = frame.locator('cg-board').evaluate('e => e.clientWidth')
                baseline = reference.locator('cg-board').evaluate('e => e.clientWidth')
                assert actual >= baseline == expected_reference, (device, actual, baseline, expected_reference)
                assert initial_board.evaluate('e => e.isConnected'), 'Board must survive a viewport change'
                assert frame.evaluate('document.documentElement.scrollWidth <= innerWidth')
                sizes[device] = {'board': actual, 'baseline': baseline}
                page.locator('#baseline').check()
                page.wait_for_function("!document.querySelector('.reference-column').inert")
                frame.locator('body').screenshot(path=str(output / f'scene-{device}.png'))
                page.locator('#baseline').uncheck()
                print(device, sizes[device], flush=True)

            page.locator('[data-group="device"][data-value="phone"]').click()
            frame.locator('#hint').click()
            page.wait_for_function("document.querySelector('[data-group=reaction][data-value=hint]').getAttribute('aria-pressed') === 'true'")
            assert frame.locator('.cg-custom-svgs, .cg-shapes').count() > 0
            frame.locator('#reset').click()
            frame.wait_for_function("document.body.dataset.reaction === 'waiting'")
            page.locator('#motion').uncheck()
            frame.wait_for_function("getComputedStyle(document.querySelector('#rabbit')).animationName === 'none'")
            page.locator('#motion').check()
            frame.wait_for_function("getComputedStyle(document.querySelector('#rabbit')).animationName === 'breathe'")
            page.emulate_media(reduced_motion='reduce')
            frame.wait_for_function("getComputedStyle(document.querySelector('#rabbit')).animationName === 'none'")
            page.emulate_media(reduced_motion='no-preference')
            page.locator('#save-choice').focus()
            page.keyboard.press('Enter')
            assert 'gardée' in page.locator('#saved-status').inner_text()
            saved = page.locator('#choice-link').input_value()
            assert page.evaluate('Object.keys(localStorage)') == ['xchess-white-rabbit-preview-v1']
            assert page.evaluate('indexedDB.databases().then(d => d.length)') == 0
            page.goto(url, wait_until='networkidle')
            assert page.locator('#choice-link').input_value() == saved
            page.evaluate("Object.defineProperty(navigator, 'clipboard', { value: {writeText: () => Promise.reject(new Error('test'))} })")
            page.locator('#copy-link').click()
            assert page.locator('#choice-link').evaluate('e => e.selectionEnd - e.selectionStart') > 0
            page.locator('.intro').scroll_into_view_if_needed()
            page.screenshot(path=str(output / 'desktop.png'), full_page=True)
            for width, height in [(390, 844), (820, 1180)]:
                page.set_viewport_size({'width': width, 'height': height})
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                page.screenshot(path=str(output / f'page-{width}.png'), full_page=True)

            isolated = browser.new_context(viewport={'width': 1440, 'height': 1000}, service_workers='block')
            isolated.add_init_script("Object.defineProperty(window, 'localStorage', { get() { throw new Error('denied') } })")
            blocked = isolated.new_page()
            blocked.on('pageerror', lambda error: errors.append(str(error)))
            blocked.goto(url + '?style=%3Cscript%3E&board=unknown&device=invalid', wait_until='networkidle')
            assert blocked.locator('[data-group="style"][data-value="illustration"]').get_attribute('aria-pressed') == 'true'
            blocked.locator('#save-choice').click()
            assert 'indisponible' in blocked.locator('#saved-status').inner_text()
            assert not errors, errors
        finally:
            browser.close()
    report = {'combinations': combinations, 'board_sizes': sizes, 'javascript_errors': errors,
              'checks': ['12 images', 'fixed legal position', '5 themes', '5 reactions', '3 devices',
                         'iframe actions', 'keyboard', 'reduced motion', 'save and reload',
                         'clipboard fallback', 'blocked storage', 'URL allowlist', 'no app database']}
    (output / 'checks.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://127.0.0.1:5175/tools/previews/white-rabbit/index.html')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    run(args.url, args.output)
