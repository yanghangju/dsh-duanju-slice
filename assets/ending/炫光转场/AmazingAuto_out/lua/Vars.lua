
_G.considerTemplate = false
_G.templateDividingTime = 0.5

_G.frameCnt = 23
_G.startFrame = 1
_G.aNewSeq = function(path, format, width, height)
    local re = {}
    re.path = path
    re.format = format
    re.width = width
    re.height = height
    return re
end
_G.stringK = {}
stringK[1] = aNewSeq("", "")
        
stringK["blendTexture"] = aNewSeq("resource1/seq16-9/ligh", "%s%01d.png", 640, 360)
_G.firstSectionFrames = -1
_G.secondSectionFrames = -1