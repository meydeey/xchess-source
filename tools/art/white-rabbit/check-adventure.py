"""Play season 1 through the actual keyboard interface in a disposable browser profile."""
import argparse
import json
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]
SEASON = json.loads((ROOT / 'catalog/adventure-season-1.json').read_text())
READ_FACT = '''async id => {
 const db = await new Promise((res, rej) => { const q = indexedDB.open('chessorbit-journal', 1); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error) });
 const rows = await new Promise((res, rej) => { const q = db.transaction('events').objectStore('events').getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error) }); db.close();
 return rows.filter(e => e.kind === 'activity' && e.data.event.kind === 'adventure' && e.data.event.data.encounterId === id).map(e => e.data.event).sort((a,b) => b.at - a.at || b.data.step - a.data.step)[0]?.data;
}'''
READY = "document.querySelector('.adventure-result') || document.querySelector('.adventure-next:not([hidden])') || document.querySelector('form input:not([disabled])') || document.querySelector('.adventure-status')?.textContent.includes('pause')"

def play(page, encounter, player, output):
    identity = encounter['id']
    page.goto(args.url + '/#/adventure/' + identity, wait_until='networkidle')
    page.locator('.adventure-start').click()
    page.wait_for_selector('form')
    for action in range(90):
        page.wait_for_function(READY, timeout=30000)
        if page.locator('.adventure-result').count():
            break
        fact = page.evaluate(READ_FACT, identity)
        cp = fact['checkpoint']
        if cp['phase'] == 'preparation':
            prep = cp['preparationState']
            if prep['done']:
                page.locator('.adventure-next').click()
                continue
            uci = encounter['opening']['preparation'][prep['index']] if encounter.get('opening') and cp['preparationIndex'] == 0 else cp['puzzles'][cp['preparationIndex'] - (1 if encounter.get('opening') else 0)]['moves'][prep['index']]
        else:
            payload = {**cp['duel'], 'preferred': encounter['duel']['firstMove'] if not cp['duel']['moves'] else None}
            player.stdin.write(json.dumps(payload) + '\n')
            player.stdin.flush()
            response = json.loads(player.stdout.readline())
            assert 'error' not in response, response
            uci = response['uci']
        page.locator('form input').fill(uci)
        page.locator('form button').click()
    page.wait_for_selector('.adventure-result', timeout=30000)
    cp = page.evaluate(READ_FACT, identity)['checkpoint']
    assert cp['result'] == 'won', (identity, cp)
    if output:
        page.screenshot(path=str(output / f'{identity}.png'), full_page=True)
    print(identity, 'won', len(cp['duel']['moves']), 'plies', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://127.0.0.1:5176')
    parser.add_argument('--output', type=Path, default=Path('/tmp/xchess-adventure-checks'))
    parser.add_argument('--offline', action='store_true', help='Use a production build, activate its cache, then cut browser network access')
    args = parser.parse_args()
    assert args.url.startswith(('http://127.0.0.1:', 'http://localhost:'))
    args.output.mkdir(parents=True, exist_ok=True)
    player = subprocess.Popen(['bun', str(Path(__file__).with_name('test-player.mjs'))], cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            context = browser.new_context(service_workers='allow' if args.offline else 'block', locale='fr-FR', viewport={'width': 390, 'height': 844})
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            if args.offline:
                page.goto(args.url + '/#/adventure', wait_until='domcontentloaded')
                page.wait_for_function('!!navigator.serviceWorker.controller', timeout=20000)
                page.wait_for_selector('.adventure-chapters')
                context.set_offline(True)
                page.reload(wait_until='domcontentloaded')
                page.wait_for_selector('.adventure-chapters')
            for encounter in SEASON['encounters']:
                play(page, encounter, player, args.output)
            page.goto(args.url + '/#/collection', wait_until='networkidle')
            for skin in ['explorer', 'code', 'twilight']:
                assert page.locator(f'[data-equip-rabbit={skin}]').is_enabled(), skin
            for board in ['burrow', 'code', 'passage']:
                assert page.locator(f'[data-equip-board={board}]').is_enabled(), board
            page.locator('[data-equip-rabbit=twilight]').click()
            page.wait_for_function("document.querySelector('[data-equip-rabbit=twilight]').disabled")
            page.locator('[data-equip-board=passage]').click()
            page.wait_for_function("document.documentElement.dataset.boardTheme === 'passage'")
            page.reload(wait_until='domcontentloaded')
            try:
                page.wait_for_function("document.querySelector('[data-equip-rabbit=twilight]')?.disabled && document.documentElement.dataset.boardTheme === 'passage'")
            except Exception:
                page.screenshot(path=str(args.output / 'restore-failure.png'), full_page=True)
                print('Restore diagnostics:', page.evaluate("({ hash: location.hash, title: document.querySelector('h1')?.textContent, theme: document.documentElement.dataset.boardTheme, rabbit: document.querySelector('[data-equip-rabbit=twilight]')?.outerHTML, errors: document.body.innerText.slice(-600) })"), errors, flush=True)
                raise
            assert not errors, errors
            print(f'9 encounters and all 3 chapter rewards equipped and restored: OK; offline={args.offline}; 0 JS errors', flush=True)
            browser.close()
    finally:
        player.stdin.close()
        player.wait(timeout=10)
