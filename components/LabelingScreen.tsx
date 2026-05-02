"use client";

import type { NameCategory } from "@/lib/types";

type LabelingScreenProps = {
  title: string;
  uniqueNames: string[];
  labels: Record<string, NameCategory>;
  isSaving: boolean;
  saveError: string | null;
  onTitleChange: (value: string) => void;
  onLabelChange: (name: string, value: NameCategory) => void;
  onBack: () => void;
  onSave: () => void;
};

export default function LabelingScreen({
  title,
  uniqueNames,
  labels,
  isSaving,
  saveError,
  onTitleChange,
  onLabelChange,
  onBack,
  onSave,
}: LabelingScreenProps) {
  return (
    <div className="w-full max-w-4xl rounded-3xl border border-slate-700/60 bg-slate-900/70 p-6 shadow-2xl shadow-slate-950/30">
      <label className="block text-sm font-medium text-slate-200" htmlFor="sheet-title">
        Spreadsheet title
      </label>
      <input
        id="sheet-title"
        type="text"
        value={title}
        onChange={(event) => onTitleChange(event.target.value)}
        className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 outline-none ring-cyan-400 focus:ring"
      />

      <p className="mt-5 text-sm text-slate-300">{uniqueNames.length} payees found</p>
      <div className="mt-2 max-h-80 overflow-y-auto rounded-xl border border-slate-700">
        {uniqueNames.map((name) => {
          const key = name.toLowerCase();
          return (
            <div
              key={name}
              className="flex items-center justify-between border-b border-slate-800 px-4 py-3 last:border-b-0"
            >
              <span className="text-sm text-slate-100">{name}</span>
              <select
                value={labels[key] ?? ""}
                onChange={(event) => onLabelChange(name, event.target.value as NameCategory)}
                className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-100"
              >
                <option value="">(blank)</option>
                <option value="Operation">Operation</option>
                <option value="Inventory">Inventory</option>
              </select>
            </div>
          );
        })}
      </div>

      {saveError ? <p className="mt-3 text-sm text-rose-300">{saveError}</p> : null}

      <div className="mt-5 flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-slate-500 px-4 py-2 text-sm font-semibold text-slate-200"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!title.trim() || isSaving}
          className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? "Saving to Google Drive..." : "Save to Google Drive"}
        </button>
      </div>
    </div>
  );
}
