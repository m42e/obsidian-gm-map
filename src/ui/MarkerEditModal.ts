import { AbstractInputSuggest, App, Modal, Setting, TFile } from "obsidian";
import { Marker } from "../types";

export interface MarkerEditResult {
  label: string;
  color: string;
  note: string | undefined;
  linkedNote: string | undefined;
}

/** File-path autocomplete for vault notes. */
class NoteSuggest extends AbstractInputSuggest<TFile> {
  getSuggestions(query: string): TFile[] {
    const q = query.toLowerCase();
    return this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.toLowerCase().includes(q))
      .slice(0, 20);
  }

  renderSuggestion(file: TFile, el: HTMLElement): void {
    el.createEl("div", { text: file.path });
  }

  selectSuggestion(file: TFile): void {
    this.setValue(file.path);
    this.close();
  }
}

/** Modal to create or edit a DM-only marker. */
export class MarkerEditModal extends Modal {
  private result: MarkerEditResult;

  constructor(
    app: App,
    marker: Pick<Marker, "label" | "color" | "note" | "linkedNote">,
    private onSubmit: (result: MarkerEditResult | null) => void,
    private onDelete?: () => void
  ) {
    super(app);
    this.result = {
      label: marker.label ?? "",
      color: marker.color ?? "#d35400",
      note: marker.note,
      linkedNote: marker.linkedNote,
    };
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "DM marker" });
    contentEl.createEl("p", {
      cls: "gm-map-modal-hint",
      text: "Markers are only visible in the DM view, never to players.",
    });

    new Setting(contentEl).setName("Label").addText((t) =>
      t.setValue(this.result.label).onChange((v) => (this.result.label = v))
    );

    new Setting(contentEl).setName("Color").addColorPicker((c) =>
      c.setValue(this.result.color).onChange((v) => (this.result.color = v))
    );

    new Setting(contentEl)
      .setName("Note")
      .setDesc("Optional private note.")
      .addTextArea((t) =>
        t
          .setValue(this.result.note ?? "")
          .onChange((v) => (this.result.note = v || undefined))
      );

    new Setting(contentEl)
      .setName("Linked note")
      .setDesc("Vault note shown in the side panel when the marker is clicked.")
      .addText((t) => {
        t.setValue(this.result.linkedNote ?? "").onChange(
          (v) => (this.result.linkedNote = v || undefined)
        );
        new NoteSuggest(this.app, t.inputEl);
      });

    const buttons = new Setting(contentEl);
    if (this.onDelete) {
      buttons.addButton((b) => {
        b.setButtonText("Delete");
        if (typeof b.setDestructive === "function") {
          b.setDestructive();
        } else if (typeof b.setWarning === "function") {
          b.setWarning();
        } else {
          b.setClass("mod-warning");
        }
        b.onClick(() => {
          try {
            this.onDelete?.();
            this.close();
          } catch (e) {
            console.error("GM Map Error on marker delete click:", e);
          }
        });
      });
    }
    buttons.addButton((b) => {
      b.setButtonText("Cancel");
      b.onClick(() => {
        try {
          this.onSubmit(null);
          this.close();
        } catch (e) {
          console.error("GM Map Error on marker cancel click:", e);
        }
      });
    });
    buttons.addButton((b) => {
      b.setButtonText("Save");
      if (typeof b.setCta === "function") {
        b.setCta();
      } else {
        b.setClass("mod-cta");
      }
      b.onClick(() => {
        try {
          this.onSubmit(this.result);
          this.close();
        } catch (e) {
          console.error("GM Map Error on marker save click:", e);
        }
      });
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
