"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type SlotSettings = {
  deviceId: string;
  rotation: 0 | 90 | 180 | 270;
  mirrored: boolean;
  zoom: number;
};

const OUTPUT_WIDTH = 1920;
const OUTPUT_HEIGHT = 1080;
const ROTATIONS: SlotSettings["rotation"][] = [0, 90, 180, 270];
const CAPTURE_COUNTER_KEY = "yg_capture_version";
const RECORDING_DURATION_MS = 5000;

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function transformStyle(settings: SlotSettings) {
  const mirrorScale = settings.mirrored ? "scaleX(-1)" : "scaleX(1)";
  return `rotate(${settings.rotation}deg) ${mirrorScale} scale(${settings.zoom})`;
}

function drawFittedVideo(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  settings: SlotSettings,
) {
  const canvas = context.canvas;
  const videoWidth = video.videoWidth || OUTPUT_WIDTH;
  const videoHeight = video.videoHeight || OUTPUT_HEIGHT;
  const rotated = settings.rotation === 90 || settings.rotation === 270;
  const sourceWidth = rotated ? videoHeight : videoWidth;
  const sourceHeight = rotated ? videoWidth : videoHeight;
  const scale =
    Math.max(canvas.width / sourceWidth, canvas.height / sourceHeight) * settings.zoom;

  context.save();
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2);

  if (settings.mirrored) {
    context.scale(-1, 1);
  }

  context.rotate((settings.rotation * Math.PI) / 180);
  context.drawImage(
    video,
    (-videoWidth * scale) / 2,
    (-videoHeight * scale) / 2,
    videoWidth * scale,
    videoHeight * scale,
  );
  context.restore();
}

function createOutputCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_WIDTH;
  canvas.height = OUTPUT_HEIGHT;
  return canvas;
}

function nextCaptureName(extension: "jpg" | "webm") {
  if (typeof window === "undefined") {
    return `YG_V1.${extension}`;
  }

  const currentCount = Number(window.localStorage.getItem(CAPTURE_COUNTER_KEY) || "0");
  const nextCount = Number.isFinite(currentCount) ? currentCount + 1 : 1;
  window.localStorage.setItem(CAPTURE_COUNTER_KEY, String(nextCount));
  return `YG_V${nextCount}.${extension}`;
}

async function saveCapture(blob: Blob, filename: string) {
  const picker = (window as Window & {
    showSaveFilePicker?: (options: {
      suggestedName: string;
      types: { description: string; accept: Record<string, string[]> }[];
    }) => Promise<{
      createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
    }>;
  }).showSaveFilePicker;

  if (picker) {
    const fileHandle = await picker({
      suggestedName: filename,
      types: [
        {
          description: blob.type.startsWith("video/") ? "WebM video" : "JPEG image",
          accept: blob.type.startsWith("video/")
            ? { [blob.type || "video/webm"]: [".webm"] }
            : { "image/jpeg": [".jpg"] },
        },
      ],
    });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return "saved";
  }

  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(downloadUrl);
  return "downloaded";
}

function getVideoMimeType() {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];

  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }

  return "";
}

export default function Home() {
  const videoARef = useRef<HTMLVideoElement>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [settings, setSettings] = useState<SlotSettings>({
    deviceId: "",
    rotation: 0,
    mirrored: false,
    zoom: 1,
  });
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState("Allow camera access to detect the webcam.");
  const [photoUrl, setPhotoUrl] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSecondsLeft, setRecordingSecondsLeft] = useState<number | null>(null);

  const deviceOptions = useMemo(
    () =>
      devices.map((device, index) => ({
        id: device.deviceId,
        label: device.label || `Camera ${index + 1}`,
      })),
    [devices],
  );

  const refreshDevices = useCallback(async () => {
    const allDevices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = allDevices.filter((device) => device.kind === "videoinput");
    setDevices(videoDevices);
    setSettings((current) => ({
      ...current,
      deviceId:
        current.deviceId && videoDevices.some((device) => device.deviceId === current.deviceId)
          ? current.deviceId
          : videoDevices[0]?.deviceId || "",
    }));

    if (videoDevices.length >= 1) {
      setStatus("Webcam detected. Choose a device, then capture a photo.");
    } else {
      setStatus("No webcam detected yet. Check browser permissions and camera connection.");
    }
  }, []);

  const requestAccess = useCallback(async () => {
    try {
      setStatus("Requesting webcam access...");
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      stopStream(stream);
      await refreshDevices();
    } catch {
      setStatus("Camera access was blocked or unavailable. Allow access in the browser and try again.");
    }
  }, [refreshDevices]);

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("This browser does not support camera capture.");
      return;
    }

    requestAccess();
    navigator.mediaDevices.addEventListener?.("devicechange", refreshDevices);
    return () => navigator.mediaDevices.removeEventListener?.("devicechange", refreshDevices);
  }, [refreshDevices, requestAccess]);

  useEffect(() => {
    let cancelled = false;
    const deviceId = settings.deviceId;
    const videoElement = videoARef.current;
    if (!deviceId || !videoElement) return;

    async function openStream() {
      try {
        const nextStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            deviceId: { exact: deviceId },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });

        if (cancelled) {
          stopStream(nextStream);
          return;
        }

        setStream((current) => {
          if (current && current !== nextStream) stopStream(current);
          return nextStream;
        });
        videoElement.srcObject = nextStream;
        await videoElement.play();
      } catch {
        setStatus("Could not open the selected camera. Choose another device or refresh.");
      }
    }

    openStream();

    return () => {
      cancelled = true;
    };
  }, [settings.deviceId]);

  useEffect(
    () => () => {
      stopStream(stream);
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    },
    [stream, photoUrl],
  );

  function updateSettings(nextSettings: Partial<SlotSettings>) {
    setSettings((current) => ({ ...current, ...nextSettings }));
  }

  async function capturePhoto() {
    const video = videoARef.current;
    if (!video || !video.videoWidth) {
      setStatus("Camera A is not ready yet.");
      return;
    }

    const canvas = createOutputCanvas();
    const context = canvas.getContext("2d");
    if (!context) return;

    drawFittedVideo(context, video, settings);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.95);
    });

    if (!blob) {
      setStatus("The capture could not be created. Try again.");
      return;
    }

    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(URL.createObjectURL(blob));

    try {
      const filename = nextCaptureName("jpg");
      const saveMode = await saveCapture(blob, filename);
      setStatus(
        saveMode === "saved"
          ? `${filename} captured. Choose your Desktop in the save window to store it there.`
          : `${filename} captured and downloaded.`,
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("Capture created, but saving was cancelled.");
        return;
      }
      setStatus("Capture created, but saving failed. Try again.");
    }
  }

  async function recordVideo() {
    const video = videoARef.current;
    if (!video || !video.videoWidth || isRecording) {
      if (!video?.videoWidth) {
        setStatus("Camera A is not ready yet.");
      }
      return;
    }

    if (typeof MediaRecorder === "undefined") {
      setStatus("This browser does not support video recording.");
      return;
    }

    const mimeType = getVideoMimeType();
    const canvas = createOutputCanvas();
    const context = canvas.getContext("2d");
    if (!context) return;

    const canvasStream = canvas.captureStream(30);
    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(canvasStream, mimeType ? { mimeType } : undefined);

    let animationFrameId = 0;
    let countdownTimer = 0;
    const startedAt = performance.now();

    const renderFrame = () => {
      drawFittedVideo(context, video, settings);
      animationFrameId = window.requestAnimationFrame(renderFrame);
    };

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    const finished = new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        window.cancelAnimationFrame(animationFrameId);
        window.clearInterval(countdownTimer);
        canvasStream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks, { type: mimeType || "video/webm" });
        resolve(blob);
      };
    });

    setIsRecording(true);
    setRecordingSecondsLeft(5);
    setStatus("Recording started.");
    renderFrame();
    recorder.start();

    countdownTimer = window.setInterval(() => {
      const elapsed = performance.now() - startedAt;
      const secondsLeft = Math.max(0, Math.ceil((RECORDING_DURATION_MS - elapsed) / 1000));
      setRecordingSecondsLeft(secondsLeft);
    }, 100);

    window.setTimeout(() => {
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
    }, RECORDING_DURATION_MS);

    try {
      const blob = await finished;
      const filename = nextCaptureName("webm");
      const saveMode = await saveCapture(blob, filename);
      setStatus(
        saveMode === "saved"
          ? `${filename} recorded. Choose your Desktop in the save window to store it there.`
          : `${filename} recorded and downloaded.`,
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("Video recorded, but saving was cancelled.");
      } else {
        setStatus("Video recorded, but saving failed. Try again.");
      }
    } finally {
      setIsRecording(false);
      setRecordingSecondsLeft(null);
    }
  }

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-[#1b1d1f]">
      <section className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-6">
        <header className="grid gap-4 border-b border-[#242424]/15 pb-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#526056]">
              Webcam landscape tester
            </p>
            <h1 className="mt-1 text-3xl font-semibold sm:text-5xl">Camera A</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="secondary-button" onClick={requestAccess}>
              Refresh cameras
            </button>
          </div>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-3 py-4">
          <p className="max-w-2xl text-sm font-medium text-[#4a4f4d]">{status}</p>
          <p className="rounded-full bg-[#dce7df] px-3 py-1 text-xs font-semibold text-[#22372d]">
            {devices.length} webcam{devices.length === 1 ? "" : "s"} detected
          </p>
        </div>

        <CameraPanel
          actionLabel={photoUrl ? "Retake photo" : "Capture photo"}
          deviceOptions={deviceOptions}
          isRecording={isRecording}
          kind="photo"
          onAction={capturePhoto}
          onRecord={recordVideo}
          onChange={updateSettings}
          recordingSecondsLeft={recordingSecondsLeft}
          settings={settings}
          videoRef={videoARef}
        />
      </section>
    </main>
  );
}

function CameraPanel({
  actionLabel,
  deviceOptions,
  isRecording,
  kind,
  onAction,
  onRecord,
  onChange,
  recordingSecondsLeft,
  settings,
  videoRef,
}: {
  actionLabel: string;
  deviceOptions: { id: string; label: string }[];
  isRecording: boolean;
  kind: "photo" | "video";
  onAction: () => void;
  onRecord: () => void;
  onChange: (settings: Partial<SlotSettings>) => void;
  recordingSecondsLeft: number | null;
  settings: SlotSettings;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  const title = "Camera A";

  return (
    <section className="camera-section">
      <div className="section-top">
        <div>
          <h2>{title}</h2>
          <p>{kind === "photo" ? "Landscape photo capture" : "Landscape video preview"}</p>
        </div>
        <button className="capture-button" onClick={onAction}>
          {actionLabel}
        </button>
      </div>

      <div className="viewfinder-frame" aria-label={`${title} 16 by 9 landscape viewfinder`}>
        <video
          autoPlay
          muted
          playsInline
          ref={videoRef}
          style={{ transform: transformStyle(settings) }}
        />
        <div className="viewfinder-overlay">
          <span>{title}</span>
          <span>{isRecording ? `REC ${recordingSecondsLeft ?? 0}s` : "16:9"}</span>
        </div>
        <button
          aria-label={actionLabel}
          className="shutter-button"
          onClick={onAction}
          type="button"
        >
          <span />
        </button>
        <button
          aria-label={isRecording ? "Recording" : "Record 5 second video"}
          className={`record-button${isRecording ? " is-recording" : ""}`}
          disabled={isRecording}
          onClick={onRecord}
          type="button"
        >
          <span />
        </button>
      </div>

      <div className="controls-grid">
        <label>
          <span>Device</span>
          <select
            value={settings.deviceId}
            onChange={(event) => onChange({ deviceId: event.target.value })}
          >
            {deviceOptions.length ? (
              deviceOptions.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.label}
                </option>
              ))
            ) : (
              <option value="">No camera found</option>
            )}
          </select>
        </label>

        <div className="control-group">
          <span>Rotation</span>
          <div className="segmented">
            {ROTATIONS.map((rotation) => (
              <button
                aria-pressed={settings.rotation === rotation}
                key={rotation}
                onClick={() => onChange({ rotation })}
                type="button"
              >
                {rotation}°
              </button>
            ))}
          </div>
        </div>

        <div className="control-group">
          <span>Mirror</span>
          <div className="segmented two">
            <button
              aria-pressed={settings.mirrored}
              onClick={() => onChange({ mirrored: true })}
              type="button"
            >
              Mirror
            </button>
            <button
              aria-pressed={!settings.mirrored}
              onClick={() => onChange({ mirrored: false })}
              type="button"
            >
              No mirror
            </button>
          </div>
        </div>

        <label className="slider-group">
          <span>Zoom</span>
          <div className="slider-row">
            <input
              max="3"
              min="0.5"
              onChange={(event) => onChange({ zoom: Number(event.target.value) })}
              step="0.1"
              type="range"
              value={settings.zoom}
            />
            <strong>{settings.zoom.toFixed(1)}x</strong>
          </div>
        </label>
      </div>
    </section>
  );
}
