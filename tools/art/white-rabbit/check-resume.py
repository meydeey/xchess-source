"""Interrupt real campaign work and inject failures only in a disposable browser profile."""
import argparse
import importlib.util
import json
import subprocess
import sys
sys.dont_write_bytecode = True
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('campaign_check', HERE / 'check-adventure.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
SEASON, ROOT, READ_FACT = helper.SEASON, helper.ROOT, helper.READ_FACT
parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:5176')
args = parser.parse_args()
assert args.url.startswith(('http://127.0.0.1:', 'http://localhost:'))

READ_EVENTS = '''async () => {const db=await new Promise((res,rej)=>{const q=indexedDB.open('chessorbit-journal',1);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)});const rows=await new Promise((res,rej)=>{const q=db.transaction('events').objectStore('events').getAll();q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)});db.close();return rows}'''


def fact(page, identity):
    return page.evaluate(READ_FACT, identity)


def settled(page):
    page.wait_for_function("document.querySelector('.adventure-result') || document.querySelector('.adventure-next:not([hidden])') || document.querySelector('form input:not([disabled])') || document.querySelector('.adventure-status')?.textContent.includes('enregistrée') || document.querySelector('.adventure-status')?.textContent.includes('pause')", timeout=30000)


def submit(page, move):
    page.locator('form input').fill(move)
    page.locator('form button').click()
    settled(page)


def prep_move(cp, encounter):
    prep = cp['preparationState']
    if encounter.get('opening') and cp['preparationIndex'] == 0:
        return encounter['opening']['preparation'][prep['index']]
    return cp['puzzles'][cp['preparationIndex'] - (1 if encounter.get('opening') else 0)]['moves'][prep['index']]


def prepare(page, encounter, collision=False):
    identity = encounter['id']
    page.goto(args.url + '/#/adventure/' + identity, wait_until='networkidle')
    if page.locator('.adventure-replay').count():
        page.locator('.adventure-replay').click()
    else:
        page.locator('.adventure-start').click()
    page.wait_for_selector('form')
    settled(page)
    resumed = False
    checked_collision = False
    for _ in range(70):
        cp = fact(page, identity)['checkpoint']
        if cp['phase'] == 'duel':
            return
        if cp['preparationState']['done']:
            page.locator('.adventure-next').click()
            settled(page)
            continue
        original = fact(page, identity)
        if not resumed:
            page.reload(wait_until='networkidle')
            settled(page)
            assert fact(page, identity) == original
            resumed = True
        cp = original['checkpoint']
        item = cp['puzzles'][cp['preparationIndex']] if not encounter.get('opening') else None
        if collision and not checked_collision and item and cp['preparationState']['index'] == len(item['moves']) - 1:
            collision_id = f"adventure:{SEASON['id']}:{identity}:{original['attemptId']}:{original['step'] + 1}:puzzle"
            page.evaluate('''async id => {const db=await new Promise(res=>{const q=indexedDB.open('chessorbit-journal',1);q.onsuccess=()=>res(q.result)});await new Promise((res,rej)=>{const tx=db.transaction('events','readwrite');tx.objectStore('events').add({id,v:1,kind:'puzzle',at:Date.now(),day:'2026-10-18',device:'fault-probe',data:{ref:'collision',result:'failed'}});tx.oncomplete=res;tx.onabort=()=>rej(tx.error)});db.close()}''', collision_id)
            submit(page, prep_move(cp, encounter))
            assert page.locator('.adventure-retry-save').is_visible()
            assert fact(page, identity) == original, 'An aborted transaction must not advance the checkpoint'
            events = page.evaluate(READ_EVENTS)
            assert not any(e['kind'] == 'activity' and e['data']['event'].get('kind') == 'puzzle' for e in events), 'XP must roll back with the checkpoint'
            page.evaluate('''async id => {const db=await new Promise(res=>{const q=indexedDB.open('chessorbit-journal',1);q.onsuccess=()=>res(q.result)});await new Promise((res,rej)=>{const tx=db.transaction('events','readwrite'),store=tx.objectStore('events'),q=store.get(id);q.onsuccess=()=>{if(q.result?.device==='fault-probe')store.delete(id);else tx.abort()};tx.oncomplete=res;tx.onabort=()=>rej(tx.error)});db.close()}''', collision_id)
            page.locator('.adventure-retry-save').click()
            settled(page)
            assert fact(page, identity)['checkpoint']['preparationState']['done']
            events = page.evaluate(READ_EVENTS)
            assert len([e for e in events if e['kind'] == 'puzzle']) == 1
            assert len([e for e in events if e['kind'] == 'activity' and e['data']['event']['kind'] == 'puzzle']) == 1
            checked_collision = True
            print('Exercise interruption and real IndexedDB rollback/retry: OK', flush=True)
        else:
            submit(page, prep_move(cp, encounter))
    raise AssertionError('Preparation did not finish')


def move_for(player, encounter, cp):
    player.stdin.write(json.dumps({**cp['duel'], 'preferred': encounter['duel']['firstMove'] if not cp['duel']['moves'] else None}) + '\n')
    player.stdin.flush()
    response = json.loads(player.stdout.readline())
    assert 'error' not in response, response
    return response['uci']


player = subprocess.Popen(['bun', str(HERE / 'test-player.mjs')], cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(service_workers='block', locale='fr-FR', viewport={'width': 390, 'height': 844}, accept_downloads=True)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        first = SEASON['encounters'][0]
        prepare(page, first, collision=True)
        page.evaluate("async()=>{const {platform}=await import('/src/platform/index.js');window.testOriginalBest=platform.engine.bestMove;platform.engine.bestMove=async()=>{throw Error('isolated engine failure')}}")
        submit(page, first['duel']['firstMove'])
        assert page.locator('.adventure-retry-engine').is_visible()
        assert fact(page, first['id'])['checkpoint']['phase'] == 'duel'
        page.evaluate("async()=>{const {platform}=await import('/src/platform/index.js');platform.engine.bestMove=()=>new Promise(()=>{})}")
        page.locator('.adventure-retry-engine').click()
        before = fact(page, first['id'])
        assert before['checkpoint']['duel']['stage'] == 'engine'
        page.reload(wait_until='networkidle')
        page.wait_for_selector('.adventure-result', timeout=30000)
        assert fact(page, first['id'])['checkpoint']['result'] == 'won'
        print('Engine failure, no defeat, interruption during engine turn: OK', flush=True)

        prepare(page, first)
        page.evaluate("async()=>{const {platform}=await import('/src/platform/index.js');platform.engine.analyse=()=>new Promise(()=>{})}")
        page.locator('form input').fill(first['duel']['firstMove'])
        page.locator('form button').click()
        # wait_for_function treats a Promise as truthy in the installed browser driver.
        # Observe the synchronous UI state, then read the confirmed journal transaction.
        page.wait_for_function("document.querySelector('.adventure-turn')?.textContent.includes('vérification')")
        assert fact(page, first['id'])['checkpoint']['duel']['stage'] == 'verify'
        page.reload(wait_until='networkidle')
        page.wait_for_selector('.adventure-result', timeout=30000)
        assert fact(page, first['id'])['checkpoint']['result'] == 'won'
        print('Interruption during independent confirmation: OK', flush=True)

        second = SEASON['encounters'][1]
        prepare(page, second)
        submit(page, second['duel']['firstMove'])
        page.wait_for_selector('.adventure-result')
        final = SEASON['encounters'][2]
        prepare(page, final)
        page.evaluate("async()=>{const {platform}=await import('/src/platform/index.js');window.testOriginalAppend=platform.journal.appendMany;platform.journal.appendMany=events=>events.some(e=>e.kind==='activity'&&e.data.event.kind==='adventure'&&e.data.event.data.checkpoint.phase==='result')?Promise.reject(Error('isolated unlock failure')):window.testOriginalAppend(events)}")
        for _ in range(6):
            cp = fact(page, final['id'])['checkpoint']
            submit(page, move_for(player, final, cp))
            if page.locator('.adventure-retry-save').is_visible():
                break
        assert page.locator('.adventure-retry-save').is_visible()
        assert fact(page, final['id'])['checkpoint']['phase'] == 'duel'
        page.goto(args.url + '/#/collection', wait_until='networkidle')
        assert page.locator('[data-equip-rabbit=explorer]').is_disabled()
        page.goto(args.url + '/#/adventure/' + final['id'], wait_until='networkidle')
        page.wait_for_selector('.adventure-retry-save:not([hidden])')
        page.evaluate("async()=>{const {platform}=await import('/src/platform/index.js');platform.journal.appendMany=window.testOriginalAppend}")
        page.locator('.adventure-retry-save').click()
        page.wait_for_selector('.adventure-result')
        assert fact(page, final['id'])['checkpoint']['result'] == 'won'
        page.goto(args.url + '/#/collection', wait_until='networkidle')
        assert page.locator('[data-equip-rabbit=explorer]').is_enabled()
        print('Unlock waits for confirmed storage: OK', flush=True)

        page.goto(args.url + '/#/settings', wait_until='networkidle')
        with page.expect_download() as download_info:
            page.locator('.btn-backup-export').click()
        backup = Path(download_info.value.path()).read_bytes()
        original = page.evaluate(READ_EVENTS)
        for _ in range(2):
            with page.expect_navigation(wait_until='networkidle'):
                page.locator('.backup-file').set_input_files({'name': 'repeat.json', 'mimeType': 'application/json', 'buffer': backup})
        assert len(page.evaluate(READ_EVENTS)) == len(original)
        page.goto(args.url + '/#/adventure', wait_until='networkidle')
        assert page.locator('a.adventure-encounter').count() == 5
        assert not errors, errors
        print('Export/import repeated twice, 3 wins and chapter reward preserved: OK; 0 JS errors', flush=True)
        browser.close()
finally:
    player.stdin.close()
    player.wait(timeout=10)
