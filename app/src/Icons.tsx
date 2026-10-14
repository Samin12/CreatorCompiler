import type {ComponentType,SVGProps} from 'react';
import {List as IList} from 'iconoir-react';
import {ArrowLeft as IArrowLeft,ArrowRight as IArrowRight,SoundHigh as IAudioLines,Camera as ICamera,Check as ICheck,NavArrowDown as IChevronDown,NavArrowLeft as IChevronLeft,NavArrowRight as IChevronRight,Clock as IClock3,MediaVideoList as IClapperboard,Copy as ICopy,Download as IDownload,Page as IFileText,MediaVideo as IFilm,Folder as IFolderOpen,ViewGrid as IGrid2X2,ClockRotateRight as IHistory,HomeSimple as IHome,MediaImage as IImage,MultiplePages as ILayers,LayoutRight as ILayoutTemplate,Refresh as ILoaderCircle,Magnet as IMagnet,Expand as IMaximize2,Microphone as IMic,Minus as IMinus,MoreHoriz as IMoreHorizontal,CursorPointer as IMousePointer2,MusicDoubleNote as IMusic,Pause as IPause,Play as IPlay,Plus as IPlus,RedoAction as IRedo2,Cut as IScissors,Search as ISearch,Settings as ISettings2,SkipPrev as ISkipBack,SkipNext as ISkipForward,Sparks as ISparkles,ClosedCaptionsTag as ISubtitles,Bin as ITrash2,Text as IType,UndoAction as IUndo2,Upload as IUpload,VideoCamera as IVideo,MagicWand as IWandSparkles,Xmark as IX,ZoomIn as IZoomIn,Drag as IGripVertical,AlignCenter as IAlignCenter} from 'iconoir-react';

import {Computer as IMonitor,Square as ISquare,CheckCircle as ICheckCircle2,Restart as IRotateCcw,Flip as IFlipHorizontal} from 'iconoir-react';

// Iconoir MIT icons. A thin size adapter preserves the shared control interface.
type Props=SVGProps<SVGSVGElement>&{size?:number|string};
function icon(Component:ComponentType<SVGProps<SVGSVGElement>>){return function Icon({size=24,strokeWidth=1.5,...props}:Props){return <Component width={size} height={size} strokeWidth={strokeWidth} aria-hidden={props['aria-label']?undefined:true} {...props}/>;};}
export const ArrowLeft=icon(IArrowLeft);
export const ArrowRight=icon(IArrowRight);
export const AudioLines=icon(IAudioLines);
export const Camera=icon(ICamera);
export const Check=icon(ICheck);
export const ChevronDown=icon(IChevronDown);
export const ChevronLeft=icon(IChevronLeft);
export const ChevronRight=icon(IChevronRight);
export const Clock3=icon(IClock3);
export const Clapperboard=icon(IClapperboard);
export const Copy=icon(ICopy);
export const Download=icon(IDownload);
export const FileText=icon(IFileText);
export const Film=icon(IFilm);
export const FolderOpen=icon(IFolderOpen);
export const Grid2X2=icon(IGrid2X2);
export const History=icon(IHistory);
export const Home=icon(IHome);
export const Image=icon(IImage);
export const Layers=icon(ILayers);
export const LayoutTemplate=icon(ILayoutTemplate);
export const LoaderCircle=icon(ILoaderCircle);
export const Magnet=icon(IMagnet);
export const Maximize2=icon(IMaximize2);
export const Mic=icon(IMic);
export const Minus=icon(IMinus);
export const MoreHorizontal=icon(IMoreHorizontal);
export const MousePointer2=icon(IMousePointer2);
export const Music=icon(IMusic);
export const Pause=icon(IPause);
export const Play=icon(IPlay);
export const Plus=icon(IPlus);
export const Redo2=icon(IRedo2);
export const Scissors=icon(IScissors);
export const Search=icon(ISearch);
export const Settings2=icon(ISettings2);
export const SkipBack=icon(ISkipBack);
export const SkipForward=icon(ISkipForward);
export const Sparkles=icon(ISparkles);
export const Subtitles=icon(ISubtitles);
export const Trash2=icon(ITrash2);
export const Type=icon(IType);
export const Undo2=icon(IUndo2);
export const Upload=icon(IUpload);
export const Video=icon(IVideo);
export const WandSparkles=icon(IWandSparkles);
export const X=icon(IX);
export const ZoomIn=icon(IZoomIn);
export const GripVertical=icon(IGripVertical);
export const AlignCenter=icon(IAlignCenter);

export const Monitor=icon(IMonitor);
export const Square=icon(ISquare);
export const CheckCircle2=icon(ICheckCircle2);
export const RotateCcw=icon(IRotateCcw);
export const FlipHorizontal=icon(IFlipHorizontal);

export const Structured=icon(IList);
// Independently drawn geometric symbols matching the observed control vocabulary.
export function Elements({size=18,...props}:Props){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d="M4 10.5 7.2 4l3.3 6.5M5.1 8.3h4.2M4 16.5h6M7 13.5v6"/><circle cx="17.4" cy="6.7" r="2.6"/><rect x="13.3" y="13.3" width="6.7" height="6.7" rx=".25"/></svg>;}
export function QuickRecord({size=18,...props}:Props){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><rect x="3" y="7" width="12" height="10" rx=".6"/><path d="m15 12 6-4.7v9.4L15 12M6 10l2 2-2 2m4-4 2 2-2 2"/></svg>;}
