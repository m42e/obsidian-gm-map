import { App, Modal, Setting } from "obsidian";
import { Token } from "../types";
import { StatblockIntegration } from "../integration/statblocks";

export interface TokenEditResult {
  label: string;
  color: string;
  radius: number;
  creature: string | undefined;
  visible: boolean;
}

/** Modal to create or edit a token, including linking a bestiary creature. */
export class TokenEditModal extends Modal {
  private result: TokenEditResult;

  constructor(
    app: App,
    private statblocks: StatblockIntegration,
    token: Pick<Token, "label" | "color" | "radius" | "creature" | "visible">,
    private onSubmit: (result: TokenEditResult | null) => void,
    private onDelete?: () => void
  ) {
    super(app);
    this.result = {
      label: token.label ?? "",
      color: token.color ?? "#c0392b",
      radius: token.radius ?? 30,
      creature: token.creature,
      visible: token.visible ?? true,
    };
  }

  onOpen(): void {
    try {
      const { contentEl } = this;
      contentEl.createEl("h3", { text: "Token" });

      new Setting(contentEl).setName("Label").addText((t) =>
        t.setValue(this.result.label).onChange((v) => (this.result.label = v))
      );

      new Setting(contentEl).setName("Color").addColorPicker((c) =>
        c.setValue(this.result.color).onChange((v) => (this.result.color = v))
      );

      new Setting(contentEl)
        .setName("Radius")
        .setDesc("Token radius in image pixels.")
        .addText((t) =>
          t.setValue(String(this.result.radius)).onChange((v) => {
            const n = Number(v);
            if (!Number.isNaN(n) && n > 0) this.result.radius = n;
          })
        );

      new Setting(contentEl)
        .setName("Visible to players")
        .setDesc("When off, this token is hidden from the player view.")
        .addToggle((t) =>
          t.setValue(this.result.visible).onChange((v) => (this.result.visible = v))
        );

      let creatures: string[] = [];
      try {
        creatures = this.statblocks.listCreatures() ?? [];
      } catch (err) {
        console.error("GM Map: Failed to list creatures", err);
      }

      const creatureSetting = new Setting(contentEl)
        .setName("Linked creature")
        .setDesc(
          this.statblocks.available
            ? "Bind this token to a Fantasy Statblocks bestiary creature."
            : "Fantasy Statblocks not detected — type a name to store for later."
        );

      if (this.statblocks.available && creatures.length > 0) {
        creatureSetting.addDropdown((d) => {
          d.addOption("", "— none —");
          for (const name of creatures) d.addOption(name, name);
          d.setValue(this.result.creature ?? "");
          d.onChange((v) => (this.result.creature = v || undefined));
        });
      } else {
        creatureSetting.addText((t) =>
          t
            .setValue(this.result.creature ?? "")
            .onChange((v) => (this.result.creature = v || undefined))
        );
      }

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
              console.error("GM Map Error on delete click:", e);
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
            console.error("GM Map Error on cancel click:", e);
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
            console.error("GM Map Error on save click:", e);
          }
        });
      });
    } catch (err) {
      console.error("GM Map: Error in TokenEditModal.onOpen", err);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
