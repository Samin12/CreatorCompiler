import type { ShortcutOverrides } from './shortcuts';

export type DesktopMediaAccessStatus = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown' | 'unsupported';
export type DesktopPrivacySection = 'camera' | 'microphone' | 'screen' | 'system-audio';
export interface DesktopMediaPermissions {
 platform: string;
 camera: DesktopMediaAccessStatus;
 microphone: DesktopMediaAccessStatus;
 screen: DesktopMediaAccessStatus;
 /** Electron does not expose a separate system-audio permission query. */
 systemAudio: 'unknown' | 'unsupported';
}
export interface DesktopShortcutStatus {
 active: boolean;
 registered: Array<{action: string; accelerator: string}>;
 conflicts: Array<{action: string; accelerator: string; reason: string}>;
}
export interface DesktopCaptureRect { x: number; y: number; width: number; height: number; }
export interface DesktopCaptureDisplay {
 id: string;
 label: string;
 /** Global desktop coordinates in device-independent pixels. May be negative. */
 bounds: DesktopCaptureRect;
 scaleFactor: number;
 /** Estimate only. Crop the delivered video using its actual pixel dimensions. */
 pixelSize: {width: number; height: number};
 primary: boolean;
}
export interface DesktopCaptureSource {
 id: string;
 kind: 'display' | 'window';
 label: string;
 displayId?: string;
}
export interface DesktopCaptureSelection {
 token: string;
 sourceId: string;
 kind: 'display' | 'window' | 'region';
 label: string;
 displayId?: string;
 displayBounds?: DesktopCaptureRect;
 scaleFactor?: number;
 crop?: {
  normalized: DesktopCaptureRect;
  /** Relative to the selected display, not global desktop coordinates. */
  dip: DesktopCaptureRect;
  /** Native-pixel estimate; normalized is authoritative for the delivered stream. */
  pixels: DesktopCaptureRect;
  sourcePixelSize: {width: number; height: number};
 };
}
/** Persist source geometry, never an expiring native capture token. */
export type SavedDesktopCaptureSelection = Omit<DesktopCaptureSelection,'token'>;
export interface DesktopRecordingHudState {
 projectName: string; script: string; cameraEnabled: boolean; mirror: boolean;
 hideMain: boolean; status: 'starting'|'recording'|'paused'|'saving'|'idle'; elapsed: number;
 cameraFrame?: string|null;
 cameraLabel?:string; microphoneLabel?:string; systemAudioLabel?:string; countdown?:number|null;
}
export interface DesktopNativeRecordingResult {
 id: string; status: string; excludesSceneForge: boolean; startedAtMs: number;
 width?: number; height?: number; duration?: number; transitionAtMs?: number;
 videoPath?: string; audioPath?: string; droppedVideo?: number; droppedAudio?: number; warning?: string;
}
export interface DesktopNativeRecordingEvent {
 id: string; type: 'started'|'paused'|'resumed'|'stopped'|'preview'|'error';
 image?: string; width?: number; height?: number; duration?: number; message?: string;
}
export interface SceneForgeDesktopBridge {
 platform: string;
 chooseMedia(): Promise<string[]>;
 chooseBorumi(): Promise<string | null>;
 chooseFolder?(): Promise<string | null>;
 listCaptureSources?(): Promise<{displays: DesktopCaptureDisplay[]; sources: DesktopCaptureSource[]}>;
 /** Arms one getDisplayMedia request for 60 seconds. Returns null on cancellation. */
 chooseCaptureSource?(options: {sourceId: string; mode: 'display' | 'window' | 'region'; initialRegion?: DesktopCaptureRect}): Promise<DesktopCaptureSelection | null>;
 /** Restore only the same, still-present source when macOS already grants access. */
 restoreCaptureSource?(selection: SavedDesktopCaptureSelection): Promise<DesktopCaptureSelection | null>;
 cancelCaptureSelection?(token?: string): Promise<void>;
 beginRecordingHud?(state: DesktopRecordingHudState): Promise<{id:string;visible:boolean}>;
 updateRecordingHud?(state: Partial<DesktopRecordingHudState>, id?:string): Promise<{visible:boolean}>;
 endRecordingHud?(id?:string): Promise<void>;
 onRecordingHudCommand?(handler:(command:'pause'|'resume'|'stop')=>void):()=>void;
 getNativeRecordingStatus?(): Promise<{available:boolean;engine:string;excludesSceneForge:boolean}>;
 startNativeRecording?(options:{selection?:DesktopCaptureSelection;systemAudio:boolean;recordVideo?:boolean;fps?:number;maxDimension?:number}):Promise<DesktopNativeRecordingResult>;
 pauseNativeRecording?(id:string):Promise<DesktopNativeRecordingResult>;
 resumeNativeRecording?(id:string):Promise<DesktopNativeRecordingResult>;
 stopNativeRecording?(id:string):Promise<DesktopNativeRecordingResult>;
 onNativeRecordingEvent?(handler:(event:DesktopNativeRecordingEvent)=>void):()=>void;
 getMediaPermissions?(): Promise<DesktopMediaPermissions>;
 requestMediaPermission?(permission: 'camera' | 'microphone'): Promise<{permission: 'camera' | 'microphone'; granted: boolean; status: DesktopMediaAccessStatus}>;
 openPrivacySettings?(section: DesktopPrivacySection): Promise<void>;
 reveal(path: string): Promise<void>;
 onShortcutAction?(handler: (action: string) => void): () => void;
 setShortcutContext?(context: {workspace: 'home' | 'script' | 'record' | 'edit' | 'teleprompter'; editable: boolean; timelineFocused: boolean; availableActions: string[]; bindings?: ShortcutOverrides}): Promise<DesktopShortcutStatus>;
 onShortcutStatus?(handler: (status: DesktopShortcutStatus) => void): () => void;
}
declare global { interface Window { sceneForge?: SceneForgeDesktopBridge; } }
