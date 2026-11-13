"""Exercise the local workshop in an isolated browser, without touching player data."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright


def run(url, output):
    output.mkdir(parents=True, exist_ok=True)
    errors = []
    sizes = {}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(service_workers='block', locale='fr-FR', viewport={'width': 390, 'height': 844})
        page = context.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(url + '/#/collection', wait_until='networkidle')
        assert page.locator('.skin-card').count() == 7
        assert page.locator('.board-theme-card').count() == 5
        assert page.locator('[data-equip-rabbit]:disabled').count() == 7
        board = page.locator('cg-board').element_handle()
        page.locator('[data-try-rabbit="egyptian"]').click()
        page.locator('[data-try-board="code"]').click()
        assert page.locator('.collection-scene').get_attribute('data-board-preview') == 'code'
        assert page.locator('html').get_attribute('data-board-theme') == 'current'
        assert page.locator('.collection-companion img').get_attribute('src').endswith('egyptian-idle.png')
        assert board.evaluate('e => e.isConnected')
        page.locator('[data-equip-board="club"]').click()
        page.wait_for_function("document.documentElement.dataset.boardTheme === 'club'")
        page.reload(wait_until='networkidle')
        assert page.locator('html').get_attribute('data-board-theme') == 'club'
        assert page.locator('[data-equip-board="club"]').is_disabled()
        assert page.locator('.collection-companion img').get_attribute('src').endswith('origin-idle.png')
        for name, width, height in [('phone', 390, 844), ('tablet-portrait', 820, 1180), ('tablet-landscape', 1180, 820), ('mac', 1440, 1000)]:
            page.set_viewport_size({'width': width, 'height': height})
            page.locator('.collection-scene').scroll_into_view_if_needed()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.screenshot(path=str(output / f'workshop-{name}.png'), full_page=True)
        page.goto(url + '/#/exercises/tactics', wait_until='networkidle')
        page.locator('.rabbit-companion').wait_for()
        assert page.locator('.rabbit-companion').count() == 1
        for name, width, height in [('phone', 390, 844), ('tablet-portrait', 820, 1180), ('tablet-landscape', 1180, 820)]:
            page.set_viewport_size({'width': width, 'height': height})
            page.wait_for_timeout(150)
            width_with = page.locator('cg-board').evaluate('e => e.clientWidth')
            page.locator('.rabbit-companion').evaluate('e => e.hidden = true')
            page.wait_for_timeout(150)
            width_without = page.locator('cg-board').evaluate('e => e.clientWidth')
            assert width_with == width_without, (name, width_with, width_without)
            page.locator('.rabbit-companion').evaluate('e => e.hidden = false')
            sizes[name] = width_with
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.screenshot(path=str(output / f'exercise-{name}.png'), full_page=True)
        # Use the real backup import path twice; duplicate attempts cannot grant a skin.
        now = 1792339200000
        events = [{'id': f'check:{i}', 'kind': 'puzzle', 'v': 1, 'device': 'workshop-check', 'at': now + i, 'day': '2026-10-18', 'data': {'ref': 'same-puzzle', 'cat': 'technique', 'mode': 'technique', 'result': 'solved'}} for i in range(50)]
        def restore(events):
            page.goto(url + '/#/settings', wait_until='networkidle')
            with page.expect_navigation(wait_until='networkidle'):
                page.locator('.backup-file').set_input_files({'name': 'check.json', 'mimeType': 'application/json', 'buffer': json.dumps({'format': 'chessorbit-journal', 'version': 1, 'events': events}).encode()})
            page.goto(url + '/#/collection', wait_until='networkidle')
        restore(events)
        restore(events)
        assert page.locator('[data-equip-rabbit="candy"]').is_disabled()
        for i in range(10):
            events.append({'id': f'distinct:{i}', 'kind': 'puzzle', 'v': 1, 'device': 'workshop-check', 'at': now + i, 'day': '2026-10-18', 'data': {'ref': f'p{i}', 'cat': 'technique', 'mode': 'technique', 'result': 'solved', 'aided': True}})
        restore(events)
        assert page.locator('[data-equip-rabbit="egyptian"]').is_enabled()
        assert page.locator('[data-equip-rabbit="candy"]').is_enabled()
        page.locator('[data-equip-rabbit="egyptian"]').click()
        page.locator('[data-setting="companionComments"]').uncheck()
        page.locator('[data-setting="companionAnimations"]').uncheck()
        page.locator('[data-setting="companionVisible"]').uncheck()
        page.wait_for_function("!document.querySelector('[data-setting=companionVisible]').disabled")
        page.reload(wait_until='networkidle')
        assert page.locator('[data-equip-rabbit="egyptian"]').is_disabled()
        for setting in ['companionComments', 'companionAnimations', 'companionVisible']:
            assert not page.locator(f'[data-setting="{setting}"]').is_checked()
        page.goto(url + '/#/exercises/tactics', wait_until='networkidle')
        assert page.locator('.rabbit-companion').is_hidden()
        for locale, heading in [('fr', 'Atelier du lapin'), ('en', 'Rabbit workshop'), ('es', 'Taller del conejo')]:
            page.goto(url + '/#/settings', wait_until='networkidle')
            page.locator('.f-locale').select_option(locale)
            page.goto(url + '/#/collection', wait_until='networkidle')
            assert page.locator('h1').inner_text() == heading
            assert page.locator('html').get_attribute('lang') == locale
        assert not errors, errors
        context.close()
        browser.close()
    (output / 'workshop-results.json').write_text(json.dumps({'errors': errors, 'boardSizesWithAndWithoutRabbit': sizes, 'imports': 'duplicate and distinct successful'}, ensure_ascii=False, indent=2))
    print('Workshop, persistence, repeated imports, 3 locales, 4 viewports: OK', sizes)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://127.0.0.1:5176')
    parser.add_argument('--output', type=Path, default=Path('/tmp/xchess-workshop-checks'))
    args = parser.parse_args()
    assert args.url.startswith(('http://127.0.0.1:', 'http://localhost:'))
    run(args.url.rstrip('/'), args.output)
