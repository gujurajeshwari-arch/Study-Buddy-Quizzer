import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  ClipboardPaste,
  Copy,
  Download,
  ImagePlus,
  Loader2,
  RotateCcw,
  ScanText,
  Trash2,
} from "lucide-react";
import type { ImageExtractionMode, ImageExtractionResult } from "../types/study";
import { formatBytes, prepareImageForOcr, type PreparedImage } from "../utils/image";

interface ImageToTextStageProps {
  initialFile: File | null;
  onConsumeInitialFile: () => void;
  existingNotesHasContent: boolean;
  isGeneratingStudySet: boolean;
  onSendToNotes: (text: string, mode: "replace" | "append") => void;
  onBuildStudySetFromText: (text: string) => void;
}

const MODE_OPTIONS: Array<{ id: ImageExtractionMode; label: string; hint: string }> = [
  {
    id: "structured",
    label: "Clean Notes",
    hint: "Organizes headings, bullets, and equations into readable study notes.",
  },
  {
    id: "verbatim",
    label: "Exact Text",
    hint: "Transcribes visible text line-by-line without reformatting.",
  },
  {
    id: "outline",
    label: "Study Outline",
    hint: "Condenses key definitions, formulas, and concepts into an outline.",
  },
];

export function ImageToTextStage({
  initialFile,
  onConsumeInitialFile,
  existingNotesHasContent,
  isGeneratingStudySet,
  onSendToNotes,
  onBuildStudySetFromText,
}: ImageToTextStageProps) {
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [mode, setMode] = useState<ImageExtractionMode>("structured");
  const [appendOutput, setAppendOutput] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isPreparing, setIsPreparing] = useState<boolean>(false);
  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [extractedText, setExtractedText] = useState<string>("");
  const [detectedType, setDetectedType] = useState<string | null>(null);
  const [extractionNote, setExtractionNote] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadImageFile = async (file: File | Blob, fallbackName?: string) => {
    setIsPreparing(true);
    setError(null);
    try {
      const prepared = await prepareImageForOcr(file, fallbackName);
      setImage(prepared);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load image.");
    } finally {
      setIsPreparing(false);
    }
  };

  useEffect(() => {
    if (initialFile) {
      void loadImageFile(initialFile, initialFile.name);
      onConsumeInitialFile();
    }
  }, [initialFile, onConsumeInitialFile]);

  // Global paste listener while Image to Text tab is active
  useEffect(() => {
    const handleWindowPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTextArea = target?.tagName === "TEXTAREA" || target?.tagName === "INPUT";
      const items = event.clipboardData?.items;
      if (!items) return;

      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const blob = item.getAsFile();
          if (blob) {
            event.preventDefault();
            void loadImageFile(blob, "clipboard-image.png");
            return;
          }
        }
      }

      if (!isTextArea && items.length > 0) {
        // Ignore non-image paste outside inputs
      }
    };

    window.addEventListener("paste", handleWindowPaste);
    return () => window.removeEventListener("paste", handleWindowPaste);
  }, []);

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await loadImageFile(file, file.name);
    e.target.value = "";
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    await loadImageFile(file, file.name);
  };

  const handlePasteFromClipboardButton = async () => {
    setError(null);
    if (!navigator.clipboard || !navigator.clipboard.read) {
      setError("Clipboard button unavailable in this browser. Press Ctrl+V or Cmd+V to paste an image.");
      return;
    }

    try {
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        const imageType = item.types.find((t) => t.startsWith("image/"));
        if (imageType) {
          const blob = await item.getType(imageType);
          await loadImageFile(blob, "clipboard-image.png");
          return;
        }
      }
      setError("No image found in your clipboard. Copy a screenshot or image first.");
    } catch {
      setError("Clipboard access was blocked. Press Ctrl+V or Cmd+V directly on this page to paste.");
    }
  };

  const handleExtractText = async () => {
    if (!image || isExtracting) return;
    setIsExtracting(true);
    setError(null);
    setExtractionNote(null);

    try {
      const res = await fetch("/api/extract-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageDataUrl: image.dataUrl,
          mimeType: image.mimeType,
          mode,
        }),
      });
      const data = (await res.json()) as ImageExtractionResult & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Could not extract text from image.");
      }

      const incoming = (data.extractedText ?? "").trim();
      setDetectedType(data.detectedType || "Image");

      if (!data.hasReadableText || !incoming) {
        setExtractionNote(
          data.notes || "No readable text was detected in this image. Try a sharper or closer crop."
        );
      } else {
        setExtractionNote(data.notes ? data.notes : null);
        if (appendOutput && extractedText.trim().length > 0) {
          setExtractedText((prev) => `${prev.trimEnd()}\n\n${incoming}`);
        } else {
          setExtractedText(incoming);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to extract text.");
    } finally {
      setIsExtracting(false);
    }
  };

  const handleCopy = async () => {
    if (!extractedText.trim()) return;
    try {
      await navigator.clipboard.writeText(extractedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Could not copy automatically. Select the text and copy with Ctrl+C or Cmd+C.");
    }
  };

  const handleDownloadTxt = () => {
    if (!extractedText.trim()) return;
    const blob = new Blob([extractedText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const baseName = image?.fileName.replace(/\.[^/.]+$/, "") || "extracted-notes";
    link.href = url;
    link.download = `${baseName}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const wordCount = extractedText.trim() ? extractedText.trim().split(/\s+/).length : 0;
  const charCount = extractedText.length;
  const activeModeHint = MODE_OPTIONS.find((m) => m.id === mode)?.hint ?? "";

  return (
    <section className="mx-auto max-w-[1280px] px-6 py-8 lg:py-10">
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          Image to text converter
        </h1>
        <p className="mt-2.5 max-w-2xl text-[15px] leading-relaxed text-slate-600">
          Upload, drop, or paste a photo of handwritten notes, lecture slides, whiteboards, or
          textbook pages to turn it into editable study text.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-stretch">
        {/* Left Zone: Image Source & OCR Controls */}
        <div className="lg:col-span-5 flex flex-col">
          <div className="flex flex-1 flex-col justify-between gap-5 rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-slate-900">Source image</span>
                {image && (
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-xs font-semibold text-sky-700 hover:text-sky-900 whitespace-nowrap shrink-0"
                    >
                      Replace
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setImage(null);
                        setError(null);
                      }}
                      className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-red-700 whitespace-nowrap shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Remove
                    </button>
                  </div>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={handleFileChange}
                className="sr-only"
              />

              {!image ? (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  className={`flex min-h-[260px] flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
                    isDragging
                      ? "border-sky-600 bg-sky-50/70"
                      : "border-slate-300 bg-slate-50/70"
                  }`}
                >
                  {isPreparing ? (
                    <div className="flex flex-col items-center gap-2 text-slate-600">
                      <Loader2 className="h-6 w-6 animate-spin text-sky-700" aria-hidden="true" />
                      <span className="text-sm font-medium">Preparing image...</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-sky-700">
                        <ImagePlus className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <p className="mt-3.5 text-sm font-semibold text-slate-900">
                        Drop an image here, or browse
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        PNG, JPG, WebP, or GIF · Paste anytime with Ctrl+V or Cmd+V
                      </p>

                      <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
                        >
                          <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
                          Choose image
                        </button>
                        <button
                          type="button"
                          onClick={handlePasteFromClipboardButton}
                          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
                        >
                          <ClipboardPaste className="h-3.5 w-3.5" aria-hidden="true" />
                          Paste image
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                >
                  <div
                    className={`overflow-hidden rounded-lg border bg-slate-50 ${
                      isDragging ? "border-sky-600 ring-2 ring-sky-600/20" : "border-slate-200"
                    }`}
                  >
                    <img
                      src={image.dataUrl}
                      alt={`Uploaded source image ${image.fileName}`}
                      referrerPolicy="no-referrer"
                      className="max-h-[300px] w-full object-contain"
                    />
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5 font-mono text-xs text-slate-500 tabular-nums">
                    <span className="max-w-[200px] truncate text-slate-700">{image.fileName}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {image.width}×{image.height}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{formatBytes(image.fileSizeBytes)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Extraction Mode & CTA */}
            <div className="space-y-4 border-t border-slate-200 pt-5">
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-700">Output format</span>
                </div>
                <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
                  {MODE_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setMode(option.id)}
                      className={`rounded-md px-2.5 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                        mode === option.id
                          ? "bg-white text-slate-900 shadow-xs"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-500">{activeModeHint}</p>
              </div>

              {extractedText.trim().length > 0 && (
                <label className="flex cursor-pointer items-center gap-2.5 text-xs font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={appendOutput}
                    onChange={(e) => setAppendOutput(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-sky-700 focus:ring-sky-700"
                  />
                  Append next scan below current extracted text
                </label>
              )}

              <button
                type="button"
                disabled={!image || isExtracting || isPreparing}
                onClick={handleExtractText}
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-sky-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 whitespace-nowrap"
              >
                {isExtracting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Reading text from image...
                  </>
                ) : (
                  <>
                    <ScanText className="h-4 w-4" aria-hidden="true" />
                    {extractedText.trim().length > 0 ? "Re-extract Text" : "Extract Text"}
                  </>
                )}
              </button>

              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" aria-hidden="true" />
                  <span>{error}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Zone: Extracted Text Editor & Study Integration */}
        <div className="lg:col-span-7 flex flex-col">
          <div className="flex flex-1 flex-col rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-baseline gap-2.5">
                <label
                  htmlFor="extracted-text-output"
                  className="text-sm font-semibold text-slate-900"
                >
                  Extracted text
                </label>
                {(detectedType || wordCount > 0) && (
                  <div className="flex items-center gap-1.5 font-mono text-xs text-slate-500 tabular-nums">
                    {detectedType && (
                      <>
                        <span>{detectedType}</span>
                        <span aria-hidden="true">·</span>
                      </>
                    )}
                    <span>{wordCount} words</span>
                    <span aria-hidden="true">·</span>
                    <span>{charCount} chars</span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!extractedText.trim()}
                  onClick={handleCopy}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap shrink-0"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      Copy
                    </>
                  )}
                </button>

                <button
                  type="button"
                  disabled={!extractedText.trim()}
                  onClick={handleDownloadTxt}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap shrink-0"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  Save .txt
                </button>

                {extractedText.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setExtractedText("");
                      setDetectedType(null);
                      setExtractionNote(null);
                      setAppendOutput(false);
                    }}
                    className="inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 whitespace-nowrap shrink-0"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    Clear
                  </button>
                )}
              </div>
            </div>

            {extractionNote && (
              <div className="mb-3 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs leading-relaxed text-amber-900">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
                <span>{extractionNote}</span>
              </div>
            )}

            <textarea
              id="extracted-text-output"
              value={extractedText}
              onChange={(e) => setExtractedText(e.target.value)}
              placeholder="Extracted text will appear here. You can edit any line directly, copy it, download a .txt file, or send it straight into flashcards and an adaptive quiz."
              rows={14}
              className="w-full flex-1 resize-y rounded-lg border border-slate-200 bg-slate-50/60 p-4 text-[15px] leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-sky-600 focus:bg-white focus:outline-none"
            />

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-5">
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  disabled={!extractedText.trim()}
                  onClick={() => onSendToNotes(extractedText, "replace")}
                  className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap shrink-0"
                >
                  Use in Notes
                </button>

                {existingNotesHasContent && (
                  <button
                    type="button"
                    disabled={!extractedText.trim()}
                    onClick={() => onSendToNotes(extractedText, "append")}
                    className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap shrink-0"
                  >
                    Append to Notes
                  </button>
                )}
              </div>

              <button
                type="button"
                disabled={isGeneratingStudySet || extractedText.trim().length < 30}
                onClick={() => onBuildStudySetFromText(extractedText)}
                className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-lg bg-sky-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 whitespace-nowrap shrink-0"
              >
                {isGeneratingStudySet ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Building flashcards & quiz...
                  </>
                ) : (
                  <>
                    Build Flashcards & Quiz
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
