//! Windows-specific queries.

/// Whether NTFS updates last-access timestamps. When disabled, "unused"
/// detection effectively relies on the last-modified time only.
///
/// `NtfsDisableLastAccessUpdate` is 0/1 on old systems and
/// `0x8000000X` (user/system managed) on Windows 10 1803+; the low bit set
/// means updates are disabled.
#[cfg(windows)]
pub fn last_access_tracking_enabled() -> Option<bool> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    let key = winreg::RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(r"SYSTEM\CurrentControlSet\Control\FileSystem")
        .ok()?;
    let value: u32 = key.get_value("NtfsDisableLastAccessUpdate").ok()?;
    Some(value & 1 == 0)
}

#[cfg(not(windows))]
pub fn last_access_tracking_enabled() -> Option<bool> {
    None
}
