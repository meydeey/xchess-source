// Point d'entrée binaire : tout le travail vit dans theorie_lib (src/lib.rs), pour rester
// réutilisable si une cible mobile s'ajoute un jour.
#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

fn main() {
  theorie_lib::run()
}
