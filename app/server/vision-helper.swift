import Foundation
import AVFoundation
import Vision
import Accelerate
import CoreImage
import ImageIO

struct Failure: Error { let message:String }
let args=CommandLine.arguments
func writeError(_ s:String){FileHandle.standardError.write(Data((s+"\n").utf8))}
func number(_ index:Int,_ value:Double)->Double{args.count>index ? Double(args[index]) ?? value:value}
func oriented(_ t:CGAffineTransform)->CGImagePropertyOrientation {
 if t.a == 0 && t.b == 1 && t.c == -1 && t.d == 0{return .right}
 if t.a == 0 && t.b == -1 && t.c == 1 && t.d == 0{return .left}
 if t.a == -1 && t.d == -1{return .down}
 return .up
}
func run() throws {
 guard args.count>=3 else{throw Failure(message:"Usage: vision-helper face|segment PATH [start] [duration] [fps] [width] [height]")}
 let mode=args[1],url=URL(fileURLWithPath:args[2]),start=max(0,number(3,0))
 if mode == "face" {
   let image:CGImage
   if let source=CGImageSourceCreateWithURL(url as CFURL,nil),let still=CGImageSourceCreateImageAtIndex(source,0,nil){image=still}
   else { let asset=AVURLAsset(url:url);let generator=AVAssetImageGenerator(asset:asset);generator.appliesPreferredTrackTransform=true;generator.maximumSize=CGSize(width:640,height:640);generator.requestedTimeToleranceBefore = .zero;generator.requestedTimeToleranceAfter = .zero;image=try generator.copyCGImage(at:CMTime(seconds:start,preferredTimescale:60000),actualTime:nil) }
   let request=VNDetectFaceRectanglesRequest();try VNImageRequestHandler(cgImage:image,options:[:]).perform([request])
   let faces=(request.results ?? []).map { face -> [String:Double] in let b=face.boundingBox;return ["x":b.minX,"y":1-b.maxY,"width":b.width,"height":b.height,"confidence":Double(face.confidence)] }
   let data=try JSONSerialization.data(withJSONObject:["faces":faces,"width":image.width,"height":image.height]);FileHandle.standardOutput.write(data);return
 }
 if mode == "track" {
   let duration=number(4,1),fps=number(5,4)
   guard duration>=0 && duration<=12 && fps==4 else{throw Failure(message:"Invalid face tracking bounds")}
   let context=CIContext(options:[.cacheIntermediates:false]),request=VNDetectFaceRectanglesRequest()
   func detect(_ image:CGImage) throws -> Any {
     try VNImageRequestHandler(cgImage:image,options:[:]).perform([request])
     let faces=(request.results ?? []).filter{$0.confidence>=0.5}.sorted { a,b in
       let aa=a.boundingBox.width*a.boundingBox.height,bb=b.boundingBox.width*b.boundingBox.height
       return aa==bb ? a.boundingBox.minX<b.boundingBox.minX : aa>bb
     }
     guard let face=faces.first else{return NSNull()};let b=face.boundingBox
     return ["x":b.minX,"y":1-b.maxY,"width":b.width,"height":b.height,"confidence":Double(face.confidence)]
   }
   var samples=[[String:Any]]()
   if let source=CGImageSourceCreateWithURL(url as CFURL,nil),let image=CGImageSourceCreateImageAtIndex(source,0,nil){
     samples.append(["time":0.0,"face":try detect(image)])
   }else{
     let asset=AVURLAsset(url:url);guard let track=asset.tracks(withMediaType:.video).first else{throw Failure(message:"No video track")}
     let reader=try AVAssetReader(asset:asset)
     reader.timeRange=CMTimeRange(start:CMTime(seconds:start,preferredTimescale:60000),duration:CMTime(seconds:duration,preferredTimescale:60000))
     let output=AVAssetReaderTrackOutput(track:track,outputSettings:[kCVPixelBufferPixelFormatTypeKey as String:kCVPixelFormatType_32BGRA]);output.alwaysCopiesSampleData=false;reader.add(output)
     guard reader.startReading() else{throw reader.error ?? Failure(message:"Reader failed")}
     var next=ceil((start-0.000001)*fps)/fps
     while let sample=output.copyNextSampleBuffer(){
       let time=CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample))
       if time+0.000001<next{continue}
       guard let pixel=CMSampleBufferGetImageBuffer(sample) else{continue}
       try autoreleasepool{
         let orientedImage=CIImage(cvPixelBuffer:pixel).oriented(oriented(track.preferredTransform)),extent=orientedImage.extent
         let scale=min(1,640/max(extent.width,extent.height)),scaled=orientedImage.transformed(by:CGAffineTransform(scaleX:scale,y:scale))
         guard let image=context.createCGImage(scaled,from:scaled.extent) else{throw Failure(message:"Face frame conversion failed")}
         samples.append(["time":time,"face":try detect(image)])
       }
       next=(floor((time+0.000001)*fps)+1)/fps
       if samples.count>60{throw Failure(message:"Too many face samples")}
     }
     if reader.status == .failed{throw reader.error ?? Failure(message:"Reader failed")};reader.cancelReading()
   }
   FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject:["samples":samples,"sampleRate":fps]));return
 }
 guard mode == "segment" else{throw Failure(message:"Unknown mode")}
 let duration=number(4,1),fps=number(5,8),width=Int(number(6,320)),height=Int(number(7,180))
 guard duration>0 && duration<=600 && fps>0 && fps<=30 && width>0 && height>0 else{throw Failure(message:"Invalid segmentation bounds")}
 let request=VNGeneratePersonSegmentationRequest();request.qualityLevel = .balanced;request.outputPixelFormat=kCVPixelFormatType_OneComponent8
 let context=CIContext(options:[.cacheIntermediates:false])
 func mask(_ handler:VNImageRequestHandler) throws -> Data {
   try handler.perform([request]);guard let pixel=request.results?.first?.pixelBuffer else {return Data(count:width*height)}
   CVPixelBufferLockBaseAddress(pixel,.readOnly);defer{CVPixelBufferUnlockBaseAddress(pixel,.readOnly)}
   guard let data=CVPixelBufferGetBaseAddress(pixel) else{throw Failure(message:"No mask buffer")}
   var source=vImage_Buffer(data:data,height:vImagePixelCount(CVPixelBufferGetHeight(pixel)),width:vImagePixelCount(CVPixelBufferGetWidth(pixel)),rowBytes:CVPixelBufferGetBytesPerRow(pixel))
   var result=Data(count:width*height)
   let error=result.withUnsafeMutableBytes{bytes -> vImage_Error in var output=vImage_Buffer(data:bytes.baseAddress!,height:vImagePixelCount(height),width:vImagePixelCount(width),rowBytes:width);return vImageScale_Planar8(&source,&output,nil,vImage_Flags(kvImageHighQualityResampling))}
   guard error == kvImageNoError else{throw Failure(message:"Mask resampling failed \(error)")};return result
 }
 let target=Int(ceil(duration*fps));var emitted=0;var latest=Data(count:width*height)
 if let source=CGImageSourceCreateWithURL(url as CFURL,nil),let still=CGImageSourceCreateImageAtIndex(source,0,nil){latest=try mask(VNImageRequestHandler(cgImage:still,options:[:]))}
 else {
   let asset=AVURLAsset(url:url);guard let track=asset.tracks(withMediaType:.video).first else{throw Failure(message:"No video track")}
   let reader=try AVAssetReader(asset:asset);reader.timeRange=CMTimeRange(start:CMTime(seconds:start,preferredTimescale:60000),duration:CMTime(seconds:duration,preferredTimescale:60000))
   let output=AVAssetReaderTrackOutput(track:track,outputSettings:[kCVPixelBufferPixelFormatTypeKey as String:kCVPixelFormatType_32BGRA]);output.alwaysCopiesSampleData=false;reader.add(output)
   guard reader.startReading() else{throw reader.error ?? Failure(message:"Reader failed")}
   let orientation=oriented(track.preferredTransform)
   while let sample=output.copyNextSampleBuffer(){let time=CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample))-start;if time+0.00001<Double(emitted)/fps{continue};guard let pixel=CMSampleBufferGetImageBuffer(sample) else{continue}
     try autoreleasepool{latest=try mask(VNImageRequestHandler(cvPixelBuffer:pixel,orientation:orientation,options:[:]))}
     while emitted<target && Double(emitted)/fps<=time+0.00001{FileHandle.standardOutput.write(latest);emitted+=1}
     if emitted>=target{break}
   }
   if reader.status == .failed {throw reader.error ?? Failure(message:"Reader failed")};reader.cancelReading()
 }
 while emitted<target{FileHandle.standardOutput.write(latest);emitted+=1}
 writeError("{\"frames\":\(emitted),\"width\":\(width),\"height\":\(height),\"fps\":\(fps)}")
 _ = context
}
do{try run()}catch{writeError("Vision error: \(error)");exit(1)}
