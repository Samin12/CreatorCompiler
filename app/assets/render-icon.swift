// Independent Creator Compiler identity. Generates standard macOS iconset sizes.
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
 let c=CGMutablePath();c.addArc(center:CGPoint(x:540,y:512),radius:236,startAngle:42 * .pi/180,endAngle:318 * .pi/180,clockwise:false)
 ctx.addPath(c);ctx.setStrokeColor(color(0xf5f7f5).cgColor);ctx.setLineWidth(116);ctx.setLineCap(.round);ctx.strokePath()
 let play=CGMutablePath();play.move(to:CGPoint(x:496,y:424));play.addLine(to:CGPoint(x:648,y:512));play.addLine(to:CGPoint(x:496,y:600));play.closeSubpath()
 let accent=CGGradient(colorsSpace:CGColorSpaceCreateDeviceRGB(),colors:[color(0x96f8b4).cgColor,color(0x54d483).cgColor] as CFArray,locations:[0,1])!
 ctx.beginTransparencyLayer(auxiliaryInfo:nil)
 ctx.addPath(play);ctx.setFillColor(NSColor.white.cgColor);ctx.fillPath()
 ctx.addPath(play);ctx.setStrokeColor(NSColor.white.cgColor);ctx.setLineWidth(44);ctx.setLineJoin(.round);ctx.strokePath()
 ctx.setBlendMode(.sourceIn);ctx.drawLinearGradient(accent,start:CGPoint(x:474,y:402),end:CGPoint(x:670,y:622),options:[.drawsBeforeStartLocation,.drawsAfterEndLocation])
 ctx.endTransparencyLayer()
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
try render(512,directory.appendingPathComponent("creator-compiler-512.png"))
try render(1024,directory.appendingPathComponent("creator-compiler-1024.png"))
