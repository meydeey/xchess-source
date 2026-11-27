use objc2::MainThreadMarker;
use objc2_app_kit::{NSSavePanel, NSModalResponseCancel, NSModalResponseOK};
use objc2_foundation::{NSData, NSDataWritingOptions, NSString};

#[tauri::command]
pub async fn save_backup(app: tauri::AppHandle, filename: String, content: String) -> Result<(), String> {
  let (sender, mut receiver) = tauri::async_runtime::channel(1);
  app.run_on_main_thread(move || {
    let result = save_with_panel(&filename, &content);
    let _ = sender.try_send(result);
  })
  .map_err(|error| error.to_string())?;

  receiver.recv().await.ok_or_else(|| "Save panel unavailable".to_owned())?
}

fn save_with_panel(filename: &str, content: &str) -> Result<(), String> {
  let mtm = MainThreadMarker::new().ok_or("Save panel must run on the main thread")?;
  let panel = NSSavePanel::savePanel(mtm);
  panel.setNameFieldStringValue(&NSString::from_str(filename));
  panel.setCanCreateDirectories(true);
  let response = panel.runModal();
  if response == NSModalResponseCancel {
    return Ok(());
  }
  if response != NSModalResponseOK {
    return Err("Save panel could not be shown".to_owned());
  }
  let url = panel.URL().ok_or("No backup destination selected")?;
  NSData::with_bytes(content.as_bytes())
    .writeToURL_options_error(&url, NSDataWritingOptions::Atomic)
    .map_err(|error| error.localizedDescription().to_string())
}
