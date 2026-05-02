"use client";

import { useRef, useState } from "react";

type UploadZoneProps = {
  file: File | null;
  onFileChange: (file: File | null) => void;
  onSubmit: () => void;
  isLoading: boolean;
  error: string | null;
};

export default function UploadZone({
  file,
  onFileChange,
  onSubmit,
  isLoading,
  error,
}: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  return (
    <div className="w-full max-w-3xl rounded-3xl border border-slate-700/60 bg-slate-900/70 p-6 shadow-2xl shadow-slate-950/30">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragActive(true);
        }}
        onDragLeave={() => setIsDragActive(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragActive(false);
          const droppedFile = event.dataTransfer.files?.[0];
          if (droppedFile) onFileChange(droppedFile);
        }}
        className={`rounded-2xl border-2 border-dashed p-10 text-center transition ${
          isDragActive
            ? "border-cyan-400 bg-cyan-500/10"
            : "border-slate-600 bg-slate-800/60 hover:border-slate-500"
        }`}
      >
        <p className="text-lg font-semibold text-slate-100">Drag and drop your BOA statement PDF</p>
        <p className="mt-2 text-sm text-slate-300">or use the button below to browse.</p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-5 rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
        >
          Browse File
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
        />
      </div>

      {file ? (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-200">
          <span>
            {file.name} ({(file.size / (1024 * 1024)).toFixed(2)} MB)
          </span>
          <button
            type="button"
            onClick={() => onFileChange(null)}
            className="rounded-md bg-slate-700 px-3 py-1 text-xs hover:bg-slate-600"
          >
            Remove
          </button>
        </div>
      ) : null}

      {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}

      <button
        type="button"
        onClick={onSubmit}
        disabled={!file || isLoading}
        className="mt-5 inline-flex w-full items-center justify-center rounded-lg bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isLoading ? "Parsing statement..." : "Parse Statement"}
      </button>
    </div>
  );
}
