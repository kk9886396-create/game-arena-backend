module.exports = function(s, io, sessions, rooms, waiting, colors, code, view, emit, startTimer) {
  s.on("match:auto", (_, ack = () => {}) => {
    const u = sessions.get(s.id);
    if (!u) return ack({ok:false,error:"पहले नाम दर्ज करें"});
    if (u.room) return ack({ok:false,error:"आप पहले से रूम में हैं"});
    const idx = waiting.findIndex(id => id !== s.id && sessions.has(id) && !sessions.get(id).room && io.sockets.sockets.has(id));
    if (idx < 0) { if (!waiting.includes(s.id)) waiting.push(s.id); return ack({ok:true,waiting:true,message:"दूसरे खिलाड़ी का इंतज़ार है"}); }
    const other = waiting.splice(idx,1)[0], v = sessions.get(other);
    if (!v) { waiting.push(s.id); return ack({ok:true,waiting:true,message:"दूसरे खिलाड़ी का इंतज़ार है"}); }
    const c = code(); const r = {code:c,players:[{id:other,name:v.name,connected:true},{id:s.id,name:u.name,connected:true}],state:{turn:0,dice:null,winner:null,pawns:{red:[-1,-1,-1,-1],green:[-1,-1,-1,-1]},message:"ऑटो मैच शुरू! लाल खिलाड़ी पहले चलेगा"}};
    rooms.set(c,r); v.room=c; u.room=c;
    const os = io.sockets.sockets.get(other); if (os) os.join(c); s.join(c);
    ack({ok:true,waiting:false,room:view(r)}); if (os) os.emit("match:found",view(r)); startTimer(r);
  });
};
