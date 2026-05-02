type SuccessScreenProps = {
  sheetUrl: string;
  onReset: () => void;
};

export default function SuccessScreen({ sheetUrl, onReset }: SuccessScreenProps) {
  return (
    <div className="w-full max-w-2xl rounded-3xl border border-emerald-500/30 bg-emerald-900/20 p-8 text-center shadow-2xl shadow-emerald-950/30">
      <h2 className="text-2xl font-bold text-emerald-100">Your spreadsheet is ready!</h2>
      <p className="mt-2 text-sm text-emerald-200">
        We finished converting your statement and saved it to Google Drive.
      </p>
      <a
        href={sheetUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-5 inline-block rounded-lg bg-emerald-300 px-4 py-2 text-sm font-semibold text-emerald-950"
      >
        Open Google Sheet
      </a>
      <div className="mt-4">
        <button
          type="button"
          onClick={onReset}
          className="rounded-lg border border-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-100"
        >
          Convert Another Statement
        </button>
      </div>
    </div>
  );
}
