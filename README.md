# GM Map

An [Obsidian](https://obsidian.md) plugin for tabletop RPG game masters. Display a map to your players on a second screen with full DM control — including fog of war, DM-only markers, and creature tokens linked to your bestiary.

> **Desktop only** — this plugin requires the Obsidian desktop app.

---

## Features

- **Dual-view layout** — a DM view (with full visibility) and a Player view (showing only what you reveal)
- **Fog of war** — paint and erase fog to reveal the map progressively to players
- **DM-only markers** — place notes and waypoints visible only to the DM
- **Creature tokens** — drag tokens onto the map and optionally link them to entries in your bestiary
- **Statblock integration** — works with the [Fantasy Statblocks](https://github.com/javalent/statblocks) plugin to display creature statblocks directly from a token
- **Persistent state** — token positions, fog, and markers are saved back into the note's code block

---

## Installation

### From the Obsidian Community Plugin directory

1. Open **Settings → Community plugins → Browse**
2. Search for **GM Map**
3. Click **Install**, then **Enable**

### Manual installation

1. Download `main.js`, `styles.css`, and `manifest.json` from the [latest release](../../releases/latest)
2. Copy the files into your vault at `.obsidian/plugins/gm-map/`
3. Reload Obsidian and enable the plugin under **Settings → Community plugins**

---

## Usage

Add a `gm-map` code block to any note to embed a map:

````markdown
```gm-map
image: "path/to/map-image.png"
```
````

Open the **DM view** to control the map and the **Player view** to show to players (e.g. on a second monitor or window). All changes made in the DM view are reflected in real time in the Player view.

### Optional: Fantasy Statblocks integration

If the [Fantasy Statblocks](https://github.com/javalent/statblocks) plugin is installed and enabled, you can link tokens to creatures from your bestiary to display their statblock in the token panel.

---

## Obsidian Developer Policy Disclosures

In compliance with the [Obsidian developer policies](https://docs.obsidian.md/Developer+policies), the following disclosures are made:

| Topic | Status |
|-------|--------|
| **Payment required** | No — this plugin is free |
| **Account required** | No — no account needed |
| **Network use** | None — this plugin makes no network requests; all data stays in your vault |
| **File access outside vault** | None — the plugin only reads and writes within your Obsidian vault |
| **Telemetry** | None — no usage data is collected |
| **Ads** | None |
| **Code obfuscation** | None — source code is fully open |

---

## License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

### Third-party licenses

This plugin is built on top of the [Obsidian Plugin API](https://github.com/obsidianmd/obsidian-api). Obsidian is a trademark of Dynalist Inc. This plugin is an independent community project and is not affiliated with or endorsed by Obsidian.

---

## Contributing

Bug reports and pull requests are welcome. Please open an issue before submitting large changes.
