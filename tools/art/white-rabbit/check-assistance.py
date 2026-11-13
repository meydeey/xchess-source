"""Verify optional assistance after 2 actual failed duels, without granting extra preparation XP."""
import argparse
import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('resume_check', HERE / 'check-adventure.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:5176')
args = parser.parse_args()
assert args.url.startswith(('http://127.0.0.1:', 'http://localhost:'))
helper.args = args
player = subprocess.Popen(['bun', str(HERE / 'test-player.mjs')], cwd=helper.ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)

def current(page, identity):
    return page.evaluate(helper.READ_FACT, identity)['checkpoint']


def ready(page):
    page.wait_for_function("document.querySelector('.adventure-result') || document.querySelector('.adventure-next:not([hidden])') || document.querySelector('form input:not([disabled])') || document.querySelector('.adventure-status')?.textContent.includes('pause')", timeout=30000)


def submit(page, uci):
    page.locator('form input').fill(uci)
    page.locator('form button').click()
    ready(page)


try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(service_workers='block', locale='fr-FR')
        page = context.new_page(); errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        encounter = helper.SEASON['encounters'][1]; identity = encounter['id']
        page.goto(args.url + '/#/adventure/' + identity, wait_until='networkidle')
        page.locator('.adventure-start').click(); page.wait_for_selector('form')
        for _ in range(50):
            ready(page); cp = current(page, identity)
            if cp['phase'] == 'duel': break
            prep = cp['preparationState']
            if prep['done']: page.locator('.adventure-next').click(); continue
            submit(page, cp['puzzles'][cp['preparationIndex']]['moves'][prep['index']])
        for attempt in range(2):
            for _ in range(6):
                ready(page)
                if page.locator('.adventure-result').count(): break
                cp = current(page, identity)
                player.stdin.write(json.dumps({**cp['duel'], 'mode': 'avoid'}) + '\n'); player.stdin.flush()
                response = json.loads(player.stdout.readline()); assert 'error' not in response, response
                submit(page, response['uci'])
            page.wait_for_selector('.adventure-result')
            assert current(page, identity)['result'] == 'lost'
            page.locator('.adventure-retry-duel').click(); page.wait_for_selector('form'); ready(page)
        counts = page.evaluate("""async()=>{const db=await new Promise(res=>{const q=indexedDB.open('chessorbit-journal',1);q.onsuccess=()=>res(q.result)});const events=await new Promise(res=>{const q=db.transaction('events').objectStore('events').getAll();q.onsuccess=()=>res(q.result)});db.close();return {attempts:events.filter(e=>e.kind==='puzzle').length,xp:events.filter(e=>e.kind==='activity'&&e.data.event.kind==='puzzle').reduce((sum,e)=>sum+e.data.event.xp,0)}}""")
        assert counts == {'attempts': 3, 'xp': 30}, counts
        assert page.locator('.adventure-hint').is_visible()
        assert not current(page, identity)['aided']
        page.evaluate("async()=>{const {platform}=await import('/src/platform/index.js');window.testHintEngine=platform.engine.analyse;platform.engine.analyse=async()=>{throw Error('isolated hint failure')}}")
        page.locator('.adventure-hint').click()
        page.wait_for_selector('.adventure-retry-engine:not([hidden])')
        assert not current(page, identity)['aided'], 'An unavailable hint has not been received'
        page.evaluate("async()=>{const {platform}=await import('/src/platform/index.js');platform.engine.analyse=window.testHintEngine}")
        page.locator('.adventure-retry-engine').click()
        page.wait_for_function("document.querySelector('.adventure-message')?.textContent.includes('Regarde')")
        assert current(page, identity)['aided']
        submit(page, encounter['duel']['firstMove'])
        page.wait_for_selector('.adventure-result')
        assert current(page, identity)['result'] == 'won'
        assert current(page, identity)['aided']
        page.goto(args.url + '/#/adventure', wait_until='networkidle')
        card = page.locator(f'a[href="#/adventure/{identity}"]')
        assert 'accompagnée' in card.inner_text()
        assert card.get_attribute('data-won') == 'true'
        # Aided wins count for progression, while the other encounter still has to be won.
        helper.play(page, helper.SEASON['encounters'][0], player, None)
        page.goto(args.url + '/#/adventure', wait_until='networkidle')
        assert page.locator('a.adventure-encounter').count() == 3
        assert not errors, errors
        print('2 failures, direct retries, hint error without aid, received hint and aided win unlock: OK; 0 JS errors', flush=True)
        browser.close()
finally:
    player.stdin.close(); player.wait(timeout=10)
