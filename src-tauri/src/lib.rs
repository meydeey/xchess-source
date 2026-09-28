// Coque native de XChess : plugins (shell pour le sidecar Stockfish, store pour la progression)
// et menu natif macOS en français. Chaque entrée du menu émet l'événement "menu" avec une action
// du contrat de plateforme (src/platform/index.js, section 14.6 de la spec), lue côté JS par
// src/platform/tauri.js via onMenu().
#[cfg(desktop)]
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
#[cfg(desktop)]
use tauri::{Emitter, Listener};
use tauri::{WebviewUrl, WebviewWindowBuilder};

// WebKit utilise la session audio de l'app. Le mode playback rend les sons audibles avec le
// commutateur Silence ; mixWithOthers préserve l'audio des autres apps.
#[cfg(target_os = "ios")]
mod audio {
  use std::ffi::{c_void, CStr};

  #[link(name = "objc")]
  extern "C" {
    fn objc_getClass(name: *const i8) -> *mut c_void;
    fn sel_registerName(name: *const i8) -> *mut c_void;
    fn objc_msgSend();
  }
  #[link(name = "AVFAudio", kind = "framework")]
  extern "C" {}

  pub fn activate() -> Result<(), String> {
    unsafe {
      let class = objc_getClass(c"AVAudioSession".as_ptr());
      if class.is_null() { return Err("Session audio iOS indisponible".into()); }
      let shared: unsafe extern "C" fn(*mut c_void, *mut c_void) -> *mut c_void = std::mem::transmute(objc_msgSend as *const ());
      let session = shared(class, sel_registerName(c"sharedInstance".as_ptr()));
      if session.is_null() { return Err("Session audio iOS indisponible".into()); }
      let mut error: *mut c_void = std::ptr::null_mut();
      let ns_string = objc_getClass(c"NSString".as_ptr());
      let string: unsafe extern "C" fn(*mut c_void, *mut c_void, *const i8) -> *mut c_void = std::mem::transmute(objc_msgSend as *const ());
      let playback = string(ns_string, sel_registerName(c"stringWithUTF8String:".as_ptr()), c"AVAudioSessionCategoryPlayback".as_ptr());
      let category: unsafe extern "C" fn(*mut c_void, *mut c_void, *mut c_void, usize, *mut *mut c_void) -> bool = std::mem::transmute(objc_msgSend as *const ());
      let ok = category(session, sel_registerName(c"setCategory:withOptions:error:".as_ptr()), playback, 1, &mut error);
      if !ok { return Err(description(error)); }
      error = std::ptr::null_mut();
      let active: unsafe extern "C" fn(*mut c_void, *mut c_void, bool, usize, *mut *mut c_void) -> bool = std::mem::transmute(objc_msgSend as *const ());
      if !active(session, sel_registerName(c"setActive:withOptions:error:".as_ptr()), true, 0, &mut error) { return Err(description(error)); }
    }
    Ok(())
  }

  unsafe fn description(error: *mut c_void) -> String {
    if error.is_null() { return "Activation audio iOS impossible".into(); }
    let message: unsafe extern "C" fn(*mut c_void, *mut c_void) -> *const i8 = std::mem::transmute(objc_msgSend as *const ());
    let desc: unsafe extern "C" fn(*mut c_void, *mut c_void) -> *mut c_void = std::mem::transmute(objc_msgSend as *const ());
    let string = desc(error, sel_registerName(c"localizedDescription".as_ptr()));
    if string.is_null() { return "Activation audio iOS impossible".into(); }
    let chars = message(string, sel_registerName(c"UTF8String".as_ptr()));
    if chars.is_null() { return "Activation audio iOS impossible".into(); }
    CStr::from_ptr(chars).to_string_lossy().into_owned()
  }
}

#[tauri::command]
fn activate_audio() -> Result<(), String> {
  #[cfg(target_os = "ios")]
  return audio::activate();
  #[cfg(not(target_os = "ios"))]
  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![activate_audio])
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_store::Builder::default().build());
  #[cfg(desktop)]
  let builder = builder.on_menu_event(|app, event| {
    let action = event.id().0.clone();
    let _ = app.emit("menu", action);
  });
  builder
    .setup(|app| {
      #[cfg(desktop)]
      {
      let menu = build_menu(app)?;
      app.set_menu(menu)?;
      }
      create_main_window(app)?;
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("erreur au lancement de XChess");
}

// Fenêtre principale, construite ici (pas via `app.windows` de tauri.conf.json) pour pouvoir choisir
// son URL de départ AVANT la toute première navigation. Auto-test natif (spec section 10, chantier
// E4-selftest) : quand THEORIE_SELFTEST=1 est présente au lancement du process, l'URL initiale porte
// directement #/selftest, en une seule navigation (src/ui/selftest.js exécute alors toute la
// séquence et écrit son rapport dans le store). Une 2e navigation après coup
// (`window.navigate()` depuis `.setup()`, essayée d'abord) s'est révélée non fiable en pratique :
// blocage intermittent et silencieux du dialogue UCI avec le sidecar Stockfish, observé pendant ce
// chantier sur plusieurs lancements consécutifs (le process restait vivant, Stockfish bloqué en
// lecture sur son entrée standard, le webview inactif) ; jamais reproduit avec une navigation unique.
// Écoute ensuite l'événement "selftest:quit" que src/ui/selftest.js émet une fois Stockfish arrêté
// (platform.engine.dispose()), pour quitter proprement l'app.
#[cfg(desktop)]
fn create_main_window(app: &tauri::App) -> tauri::Result<()> {
  let selftest = std::env::var("THEORIE_SELFTEST").map(|v| v == "1").unwrap_or(false);
  let url = if selftest {
    WebviewUrl::App("index.html#/selftest".into())
  } else {
    WebviewUrl::App("index.html".into())
  };
  WebviewWindowBuilder::new(app, "main", url)
    .title("XChess")
    .inner_size(1280.0, 820.0)
    .min_inner_size(900.0, 600.0)
    .build()?;

  if selftest {
    let handle = app.handle().clone();
    app.listen_any("selftest:quit", move |_event| {
      handle.exit(0);
    });
  }
  Ok(())
}

#[cfg(mobile)]
fn create_main_window(app: &tauri::App) -> tauri::Result<()> {
  WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
    .title("XChess")
    .build()?;
  Ok(())
}

// Construit les 3 menus de la spec : le menu "XChess" standard (à propos, masquer, quitter...),
// "Entraînement" (raccourcis de la session en cours) et "Aller à" (navigation entre écrans).
#[cfg(desktop)]
fn build_menu(app: &tauri::App) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
  let app_menu = SubmenuBuilder::new(app, "XChess")
    .about(None)
    .separator()
    .services()
    .separator()
    .hide()
    .hide_others()
    .show_all()
    .separator()
    .quit()
    .build()?;

  let next = MenuItemBuilder::with_id("next", "Ligne suivante").accelerator("Cmd+N").build(app)?;
  let hint = MenuItemBuilder::with_id("hint", "Indice").accelerator("Cmd+I").build(app)?;
  let restart = MenuItemBuilder::with_id("restart", "Rejouer la ligne").accelerator("Cmd+R").build(app)?;
  let tab_train = MenuItemBuilder::with_id("tab:train", "S'entraîner").accelerator("Cmd+1").build(app)?;
  let tab_explore = MenuItemBuilder::with_id("tab:explore", "Explorer").accelerator("Cmd+2").build(app)?;
  let tab_lines = MenuItemBuilder::with_id("tab:lines", "Variantes").accelerator("Cmd+3").build(app)?;

  let training_menu = SubmenuBuilder::new(app, "Entraînement")
    .item(&next)
    .item(&hint)
    .item(&restart)
    .separator()
    .item(&tab_train)
    .item(&tab_explore)
    .item(&tab_lines)
    .build()?;

  let library = MenuItemBuilder::with_id("library", "Bibliothèque").build(app)?;
  let session = MenuItemBuilder::with_id("session", "Session du jour").build(app)?;
  let settings = MenuItemBuilder::with_id("settings", "Réglages").build(app)?;
  let search = MenuItemBuilder::with_id("search", "Rechercher").accelerator("Cmd+F").build(app)?;

  let goto_menu = SubmenuBuilder::new(app, "Aller à")
    .item(&library)
    .item(&session)
    .item(&settings)
    .separator()
    .item(&search)
    .build()?;

  MenuBuilder::new(app).item(&app_menu).item(&training_menu).item(&goto_menu).build()
}
