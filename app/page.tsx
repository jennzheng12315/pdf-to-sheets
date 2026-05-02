"use client";

import { useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import LabelingScreen from "@/components/LabelingScreen";
import SignIn from "@/components/sign-in";
import SuccessScreen from "@/components/SuccessScreen";
import UploadZone from "@/components/UploadZone";
import UserMenu from "@/components/UserMenu";
import type { NameCategory, ParseStatementResult, ParsedSections } from "@/lib/types";

type Stage = "upload" | "labeling" | "success";

function getDefaultSheetTitle() {
  const now = new Date();
  const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return previous.toLocaleString("en-US", { month: "long", year: "numeric" });
}

export default function Home() {
  const { data: session, status } = useSession();
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("upload");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [sheetUrl, setSheetUrl] = useState("");
  const [sheetTitle, setSheetTitle] = useState(getDefaultSheetTitle);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [uniqueNames, setUniqueNames] = useState<string[]>([]);
  const [labels, setLabels] = useState<Record<string, NameCategory>>({});
  const [sections, setSections] = useState<ParsedSections | null>(null);

  const heading = useMemo(
    () => "Upload a BOA statement and export a labeled Google Sheet in minutes.",
    [],
  );

  async function handleParse() {
    if (!file) {
      setUploadError("Please choose a PDF file first.");
      return;
    }
    if (file.type !== "application/pdf") {
      setUploadError("Only PDF files are supported.");
      return;
    }

    setUploadError(null);
    setWarnings([]);
    setIsParsing(true);

    try {
      const formData = new FormData();
      formData.append("statement", file);

      const response = await fetch("/api/parse-statement", {
        method: "POST",
        body: formData,
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to parse statement.");
      }

      const parsed = payload as ParseStatementResult;
      setSections(parsed.sections);
      setUniqueNames(parsed.uniqueNames);
      setWarnings(parsed.warnings);
      setStage("labeling");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to parse statement.";
      setUploadError(message);
    } finally {
      setIsParsing(false);
    }
  }

  async function handleSave() {
    if (!sections) return;

    setSaveError(null);
    setIsSaving(true);
    try {
      const response = await fetch("/api/export-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: sheetTitle,
          sections,
          labels,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to export sheet.");
      }

      setSheetUrl(payload.url);
      setStage("success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save sheet.";
      setSaveError(message);
    } finally {
      setIsSaving(false);
    }
  }

  function handleLabelChange(name: string, value: NameCategory) {
    setLabels((current) => ({
      ...current,
      [name.toLowerCase()]: value,
    }));
  }

  function resetFlow() {
    setStage("upload");
    setFile(null);
    setUploadError(null);
    setSaveError(null);
    setSheetUrl("");
    setWarnings([]);
    setUniqueNames([]);
    setLabels({});
    setSections(null);
    setSheetTitle(getDefaultSheetTitle());
  }

  if (status === "loading") {
    return <main className="min-h-screen bg-slate-950 p-8 text-slate-200">Loading session...</main>;
  }

  if (!session?.user) {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-20 text-slate-100">
        <div className="mx-auto max-w-5xl rounded-3xl border border-slate-700/60 bg-slate-900/60 p-10 shadow-2xl shadow-slate-950/30">
          <p className="text-sm uppercase tracking-[0.2em] text-cyan-300">BOA to Sheets</p>
          <h1 className="mt-4 font-[family-name:var(--font-space-grotesk)] text-4xl font-bold leading-tight md:text-5xl">
            {heading}
          </h1>
          <p className="mt-4 max-w-2xl text-slate-300">
            Securely parse Bank of America statements, classify payees, and generate a spreadsheet in
            your Google Drive in one flow.
          </p>
          <div className="mt-8">
            <SignIn />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100 md:px-10">
      <header className="mx-auto mb-8 flex w-full max-w-6xl items-center justify-between">
        <h1 className="font-[family-name:var(--font-space-grotesk)] text-xl font-bold text-cyan-200">
          BOA Statement Converter
        </h1>
        <UserMenu name={session.user.name ?? "User"} image={session.user.image} />
      </header>

      <section className="mx-auto flex w-full max-w-6xl justify-center">
        {stage === "upload" ? (
          <div className="w-full">
            <UploadZone
              file={file}
              onFileChange={setFile}
              onSubmit={handleParse}
              isLoading={isParsing}
              error={uploadError}
            />
            {warnings.length > 0 ? (
              <div className="mx-auto mt-4 w-full max-w-3xl rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-200">
                {warnings.join(" ")}
              </div>
            ) : null}
          </div>
        ) : null}

        {stage === "labeling" ? (
          <LabelingScreen
            title={sheetTitle}
            uniqueNames={uniqueNames}
            labels={labels}
            isSaving={isSaving}
            saveError={saveError}
            onTitleChange={setSheetTitle}
            onLabelChange={handleLabelChange}
            onBack={() => setStage("upload")}
            onSave={handleSave}
          />
        ) : null}

        {stage === "success" ? <SuccessScreen sheetUrl={sheetUrl} onReset={resetFlow} /> : null}
      </section>
    </main>
  );
}
