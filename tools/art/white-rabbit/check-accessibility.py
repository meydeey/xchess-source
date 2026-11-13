"""Check local campaign languages, keyboard input, enlarged text and companion limits."""
import argparse
import json
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
SEASON = json.loads((ROOT / 'catalog/adventure-season-1.json').read_text())
parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:5176')
parser.add_argument('--output', type=Path, default=Path('/tmp/xchess-adventure-accessibility'))
args = parser.parse_args()
assert args.url.startswith(('http://127.0.0.1:', 'http://localhost:'))
args.output.mkdir(parents=True, exist_ok=True)
fixture = subprocess.check_output(['bun', str(HERE / 'build-ui-fixture.mjs')], cwd=ROOT)
with sync_playwright() as p:
    browser = p.chromium.launch()
    errors = []
    for locale, title in [('fr', 'L’aventure du lapin blanc'), ('en', 'The white rabbit adventure'), ('es', 'La aventura del conejo blanco')]:
        context = browser.new_context(service_workers='block', locale='fr-FR', reduced_motion='reduce')
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(args.url + '/#/settings', wait_until='networkidle')
        with page.expect_navigation(wait_until='networkidle'):
            page.locator('.backup-file').set_input_files({'name': 'isolated-fixture.json', 'mimeType': 'application/json', 'buffer': fixture})
        page.goto(args.url + '/#/settings', wait_until='networkidle')
        page.locator('.f-locale').select_option(locale)
        page.goto(args.url + '/#/adventure', wait_until='networkidle')
        assert page.locator('h1').inner_text() == title
        assert page.locator('a.adventure-encounter').count() == 9
        for encounter in SEASON['encounters']:
            assert encounter['title'][locale] in page.locator(f'a[href="#/adventure/{encounter["id"]}"]').inner_text()
        for name, width, height in [('small-phone', 320, 740), ('phone', 390, 844), ('tablet', 820, 1180), ('landscape', 1180, 820), ('mac', 1440, 1000)]:
            page.set_viewport_size({'width': width, 'height': height})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (locale, name, 'map')
        page.goto(args.url + '/#/adventure/club-final', wait_until='networkidle')
        page.locator('.adventure-replay').click()
        page.wait_for_selector('form input:not([disabled])')
        assert page.locator('.rabbit-companion').get_attribute('data-animate') == 'false'
        assert not page.locator('.adventure-explanation').inner_text()
        # Use Enter, then focus must return to the next keyboard move after the saved reply.
        page.locator('form input').fill('e2e4'); page.locator('form input').press('Enter')
        page.wait_for_function("document.querySelector('.adventure-history').textContent.includes('e5')")
        page.wait_for_selector('form input:not([disabled])')
        assert page.locator('form input').evaluate('e => e === document.activeElement')
        assert SEASON['encounters'][2]['opening']['ideas'][0][locale] in page.locator('.adventure-explanation').inner_text()
        for name, width, height in [('small-phone', 320, 740), ('tablet', 820, 1180), ('landscape', 1180, 820)]:
            page.set_viewport_size({'width': width, 'height': height})
            page.wait_for_timeout(120)
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (locale, name, 'preparation')
        # Enlarge all campaign text to twice its rendered size, leaving board geometry untouched.
        page.set_viewport_size({'width': 390, 'height': 844})
        page.evaluate("""() => {const rows=[...document.querySelectorAll('.adventure-screen h1,.adventure-screen h2,.adventure-screen p,.adventure-screen small,.adventure-screen button,.adventure-screen label,.adventure-screen input,.adventure-screen a,.adventure-screen summary')].map(e=>[e,parseFloat(getComputedStyle(e).fontSize)]);for(const [e,size] of rows)e.style.fontSize=(2*size)+'px'}""")
        # The board's ResizeObserver must finish adapting after the viewport change.
        page.wait_for_function('document.documentElement.scrollWidth <= innerWidth', timeout=3000)
        page.screenshot(path=str(args.output / f'{locale}-large-text.png'), full_page=True)
    # Exercise the actual component with controlled facts and translations.
    limits = page.evaluate("""async () => {
      const { mountCompanion } = await import('/src/ui/companion.js');
      const { collectionFor } = await import('/src/core/appearance.js');
      const host=document.createElement('div'); document.body.append(host);
      const pet=mountCompanion(host,{state:{settings:{}},t:(key)=>key},{collection:collectionFor([])});
      const words=()=>host.querySelector('p').textContent;
      pet.react({type:'thinking',scope:'puzzle'}); const quiet=words()==='';
      pet.react({type:'hint',scope:'puzzle',requested:false,detail:'secret'}); const noHint=words()==='';
      pet.react({type:'puzzle',scope:'puzzle',resolved:true,result:'solved'});const first=words();
      pet.react({type:'puzzle',scope:'puzzle',resolved:true,result:'failed'});const once=words()===first;
      pet.react({type:'move',scope:'duel',duel:true,captured:'p'});
      pet.react({type:'move',scope:'duel',duel:true,promotion:'q'});const second=words();
      pet.react({type:'move',scope:'duel',duel:true,check:true});const twice=words()===second;
      pet.react({type:'duel',scope:'duel',duel:true,confirmed:true,result:'won',final:true});const final=words()==='companion.won';
      pet.react({type:'hint',scope:'duel',duel:true,requested:true,detail:'f7'});const requested=words()==='companion.hint';
      pet.setPreferences({comments:false});pet.react({type:'puzzle',scope:'new',resolved:true,result:'solved'});const silent=words()==='';
      pet.setPreferences({visible:false});const hidden=host.firstElementChild.hidden;
      pet.destroy();host.remove();return {quiet,noHint,once,twice,final,requested,silent,hidden};
    }""")
    assert all(limits.values()), limits
    assert not errors, errors
    print('FR/EN/ES, 5 viewports, keyboard, 2x text, reduced motion and comment limits: OK; 0 JS errors', flush=True)
    browser.close()
