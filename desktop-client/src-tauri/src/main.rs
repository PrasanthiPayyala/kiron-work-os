// Prevents an extra terminal window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    kiron_presence_client_lib::run()
}
