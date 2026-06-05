import { App, Modal, Setting } from "obsidian";
import { Token } from "../types";
import { StatblockIntegration } from "../integration/statblocks";

export interface TokenEditResult {
  label: string;
  color: string;
  radius: number;
  creature: string | undefined;
}

/** Modal to create or edit a token, including linking a bestiary creature. */
export class TokenEditModal extends Modal {
  private result: TokenEditResult;

  constructor(
    app: App,
    private statblocks: StatblockIntegration,
    token: Pick<Token, "label" | "color" | "radius" | "creature">,
    private onSubmit: (result: TokenEditResult | null) => void,
    private onDelete?: () => void
  ) {
    super(app);
    this.result = {
      label: token.label,
      color: token.color,
      radius: token.radius,
      creature: token.creature,
    };
  }

  onOpen(): void {
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

    const creatures = this.statblocks.listCreatures();
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
      buttons.addButton((b) =>
        b
          .setButtonText("Delete")
          .setWarning()
          .onClick(() => {
            this.onDelete?.();
            this.close();
          })
      );
    }
    buttons
      .addButton((b) =>
        b.setButtonText("Cancel").onClick(() => {
          this.onSubmit(null);
          this.close();
        })
      )
      .addButton((b) =>
        b
          .setButtonText("Save")
          .setCta()
          .onClick(() => {
            this.onSubmit(this.result);
            this.close();
          })
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
