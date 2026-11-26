use serde::Deserialize;
use tauri::{AppHandle, Url};

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Target {
  Destination,
  Report,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SponsorLinks {
  url: String,
  report_email: String,
}

fn sponsor_link(config: &str, target: Target) -> Option<Url> {
  let links: SponsorLinks = serde_json::from_str(config).ok()?;
  match target {
    Target::Destination => {
      let url = Url::parse(&links.url).ok()?;
      (url.scheme() == "https" && url.username().is_empty() && url.password().is_none())
        .then_some(url)
    }
    Target::Report => {
      let (name, domain) = links.report_email.split_once('@')?;
      let valid_name = !name.is_empty()
        && name.bytes().all(|c| c.is_ascii_alphanumeric() || b"._+-".contains(&c));
      let valid_domain = domain.contains('.')
        && domain.bytes().all(|c| c.is_ascii_alphanumeric() || b".-".contains(&c));
      if !valid_name || !valid_domain {
        return None;
      }
      Url::parse(&format!("mailto:{}?subject=XChess%20advertisement", links.report_email)).ok()
    }
  }
}

#[tauri::command]
pub(crate) async fn open_sponsor_link(app: AppHandle, target: Target) -> Result<(), String> {
  if option_env!("VITE_XCHESS_STORE") != Some("1") {
    return Err("Sponsor not configured".into());
  }
  let url = option_env!("VITE_XCHESS_SPONSOR")
    .and_then(|config| sponsor_link(config, target))
    .ok_or("Sponsor link not configured")?;
  let (reply, mut response) = tauri::async_runtime::channel(1);
  app.run_on_main_thread(move || open_on_main_thread(url, reply))
    .map_err(|error| error.to_string())?;
  match response.recv().await {
    Some(true) => Ok(()),
    _ => Err("No application opened the sponsor link".into()),
  }
}

#[cfg(any(target_os = "ios", target_os = "macos"))]
fn open_on_main_thread(url: Url, reply: tauri::async_runtime::Sender<bool>) {
  use objc2_foundation::{NSString, NSURL};

  let Some(url) = NSURL::URLWithString(&NSString::from_str(url.as_str())) else {
    let _ = reply.try_send(false);
    return;
  };
  #[cfg(target_os = "macos")]
  {
    let opened = objc2_app_kit::NSWorkspace::sharedWorkspace().openURL(&url);
    let _ = reply.try_send(opened);
  }
  #[cfg(target_os = "ios")]
  {
    use block2::RcBlock;
    use objc2::{runtime::Bool, MainThreadMarker};
    use objc2_foundation::NSDictionary;
    use objc2_ui_kit::UIApplication;

    let Some(main_thread) = MainThreadMarker::new() else {
      let _ = reply.try_send(false);
      return;
    };
    let completion = RcBlock::new(move |opened: Bool| {
      let _ = reply.try_send(opened.as_bool());
    });
    // An empty options dictionary conforms to UIKit's external URL option types.
    unsafe {
      UIApplication::sharedApplication(main_thread)
        .openURL_options_completionHandler(&url, &NSDictionary::new(), Some(&completion));
    }
  }
}

#[cfg(not(any(target_os = "ios", target_os = "macos")))]
fn open_on_main_thread(_url: Url, reply: tauri::async_runtime::Sender<bool>) {
  let _ = reply.try_send(false);
}

#[cfg(test)]
mod tests {
  use super::{sponsor_link, Target};

  const SPONSOR: &str = r#"{"url":"https://example.com/chess","reportEmail":"report@example.com"}"#;

  #[test]
  fn opens_only_the_configured_partner_or_report_address() {
    assert_eq!(sponsor_link(SPONSOR, Target::Destination).unwrap().as_str(), "https://example.com/chess");
    assert_eq!(sponsor_link(SPONSOR, Target::Report).unwrap().as_str(), "mailto:report@example.com?subject=XChess%20advertisement");
  }

  #[test]
  fn rejects_file_urls_credentials_and_ambiguous_mail_recipients() {
    for url in ["file:///example", "http://example.com", "https://a:b@example.com"] {
      assert!(sponsor_link(&format!(r#"{{"url":"{url}","reportEmail":"report@example.com"}}"#), Target::Destination).is_none());
    }
    for email in ["report@example.com?bcc=a@other.com", "report@example.com,other@example.com", "a%0D%0A@example.com"] {
      assert!(sponsor_link(&format!(r#"{{"url":"https://example.com","reportEmail":"{email}"}}"#), Target::Report).is_none());
    }
  }
}
