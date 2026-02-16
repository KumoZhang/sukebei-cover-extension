# Sukebei Cover Helper (MVP)

`Sukebei Cover Helper` is a Chrome extension for quickly previewing AV covers on `sukebei.nyaa.si`. It automatically extracts codes from torrent titles (for example: `IPZZ-750`), loads cover images when you hover on `Name`, supports click-to-zoom full screen preview, and uses local cache to speed up repeated browsing.

## Features

- Auto loads cover preview when hovering on torrent `Name`.
- Extracts code from row title using regex.
- Queries JavDB first for cover image.
- Falls back to DMM Affiliate API when JavDB has no hit and DMM credentials are configured.
- Shows a floating preview card with image and metadata.
- Caches results in local storage for faster repeated lookups.

## Setup

1. Open Chrome and go to `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked` and choose this folder:
   - `/Users/kumozhang/Codex/chajian/sukebei-cover-extension`
4. Open extension details and click `Extension options`.
5. (Optional) Fill in your `API ID` and `Affiliate ID`, then save.

## Usage

1. Go to a Sukebei list page, such as:
   - `https://sukebei.nyaa.si/?f=0&c=0_0&q=`
2. Hover your mouse on the torrent `Name` text.
3. A floating cover preview appears automatically.
4. Move mouse away to hide, or click image to zoom.

## Notes

- JavDB is used without credentials.
- DMM credentials are optional fallback.
- Not every code is guaranteed to exist in DMM results.
- Current regex targets standard patterns like `ABCD-123`.
