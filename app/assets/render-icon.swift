// Independent SceneForge identity. Generates standard macOS iconset sizes.
import AppKit
import Foundation
let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: directory.appendingPathComponent("icon.iconset"), withIntermediateDirectories: true)
func color(_ hex: Int) -> NSColor { NSColor(srgbRed: CGFloat((hex >> 16) & 255)/255, green: CGFloat((hex >> 8)&255)/255, blue: CGFloat(hex&255)/255, alpha: 1) }
func render(_ size: Int, _ output: URL) throws {
 let image = NSImage(size: NSSize(width:size,height:size))
 image.lockFocus()
 let ctx = NSGraphicsContext.current!.cgContext
 ctx.translateBy(x:0,y:CGFloat(size));ctx.scaleBy(x:CGFloat(size)/1024,y:-CGFloat(size)/1024)
 let tile=CGPath(roundedRect:CGRect(x:64,y:64,width:896,height:896),cornerWidth:204,cornerHeight:204,transform:nil)
 ctx.saveGState();ctx.addPath(tile);ctx.clip()
 let gradient=CGGradient(colorsSpace:CGColorSpaceCreateDeviceRGB(),colors:[color(0x292c2b).cgColor,color(0x101211).cgColor] as CFArray,locations:[0,1])!
 ctx.drawLinearGradient(gradient,start:CGPoint(x:200,y:64),end:CGPoint(x:820,y:960),options:[]);ctx.restoreGState()
 ctx.addPath(CGPath(roundedRect:CGRect(x:65,y:65,width:894,height:894),cornerWidth:203,cornerHeight:203,transform:nil));ctx.setStrokeColor(NSColor.white.withAlphaComponent(0.10).cgColor);ctx.setLineWidth(2);ctx.strokePath()
 let f=CGMutablePath();f.move(to:CGPoint(x:286,y:274));f.addLine(to:CGPoint(x:660,y:274));f.addQuadCurve(to:CGPoint(x:708,y:322),control:CGPoint(x:708,y:274));f.addLine(to:CGPoint(x:708,y:368));f.addLine(to:CGPoint(x:310,y:368));f.addLine(to:CGPoint(x:310,y:474));f.addLine(to:CGPoint(x:550,y:474));f.addLine(to:CGPoint(x:550,y:570));f.addLine(to:CGPoint(x:310,y:570));f.addLine(to:CGPoint(x:310,y:702));f.addQuadCurve(to:CGPoint(x:262,y:750),control:CGPoint(x:310,y:750));f.addLine(to:CGPoint(x:214,y:750));f.addLine(to:CGPoint(x:214,y:346));f.addQuadCurve(to:CGPoint(x:286,y:274),control:CGPoint(x:214,y:274));f.closeSubpath();ctx.addPath(f);ctx.setFillColor(color(0xf5f7f5).cgColor);ctx.fillPath()
 let play=CGMutablePath();play.move(to:CGPoint(x:612,y:460));play.addQuadCurve(to:CGPoint(x:642,y:443),control:CGPoint(x:612,y:425));play.addLine(to:CGPoint(x:818,y:547));play.addQuadCurve(to:CGPoint(x:818,y:581),control:CGPoint(x:848,y:564));play.addLine(to:CGPoint(x:642,y:685));play.addQuadCurve(to:CGPoint(x:612,y:668),control:CGPoint(x:612,y:703));play.closeSubpath()
 let accent=CGGradient(colorsSpace:CGColorSpaceCreateDeviceRGB(),colors:[color(0x96f8b4).cgColor,color(0x54d483).cgColor] as CFArray,locations:[0,1])!
 for path in [play as CGPath,CGPath(roundedRect:CGRect(x:376,y:654,width:174,height:96),cornerWidth:24,cornerHeight:24,transform:nil)] {ctx.saveGState();ctx.addPath(path);ctx.clip();ctx.drawLinearGradient(accent,start:CGPoint(x:580,y:420),end:CGPoint(x:850,y:720),options:[.drawsBeforeStartLocation,.drawsAfterEndLocation]);ctx.restoreGState()}
 image.unlockFocus()
 let source=NSBitmapImageRep(data:image.tiffRepresentation!)!
 let rep=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:size,pixelsHigh:size,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
 NSGraphicsContext.saveGraphicsState();NSGraphicsContext.current=NSGraphicsContext(bitmapImageRep:rep)
 source.draw(in:NSRect(x:0,y:0,width:size,height:size));NSGraphicsContext.restoreGraphicsState()
 try rep.representation(using:.png,properties:[:])!.write(to:output)
}
for size in [16,32,128,256,512] {
 try render(size,directory.appendingPathComponent("icon.iconset/icon_\(size)x\(size).png"))
 try render(size*2,directory.appendingPathComponent("icon.iconset/icon_\(size)x\(size)@2x.png"))
}
try render(512,directory.appendingPathComponent("sceneforge-512.png"))
try render(1024,directory.appendingPathComponent("sceneforge-1024.png"))
