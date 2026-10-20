module.exports = function(io, sessions, rooms, colors, code, view, emit, autoTurn) {
  const battles = new Map();
  function publish() {
    for (const socket of io.sockets.sockets.values()) {
      const u = sessions.get(socket.id);
      socket.emit("open-battle:list", [...battles.values()].map(b => ({id:b.id,name:b.name,amount:b.amount,status:b.status,mine:!!u && u.token===b.ownerToken})));
    }
  }
  io.on("connection", socket => {
    socket.on("open-battle:list:get", () => publish());
    socket.on("open-battle:create", (d, ack=()=>{}) => {
      const u=sessions.get(socket.id), amount=Number(d && d.amount);
      if(!u) return ack({ok:false,error:"पहले नाम दर्ज करें"});
      if(u.room) return ack({ok:false,error:"आप पहले से मैच में हैं"});
      if(!Number.isSafeInteger(amount)||amount<1||amount>10000)
        return ack({ok:false,error:"Demo Coins 1 से 10000 तक दर्ज करें"});
      const id=code();
      battles.set(id,{id,name:u.name,amount,ownerToken:u.token,ownerId:socket.id,status:"open"});
      publish();
      ack({ok:true,id});
    });
    socket.on("open-battle:cancel", (d, ack=()=>{}) => {
      const u=sessions.get(socket.id), b=battles.get(d && d.id);
      if(!u) return ack({ok:false,error:"पहले नाम दर्ज करें"});
      if(!b || b.status!=="open") return ack({ok:false,error:"Battle उपलब्ध नहीं है"});
      if(b.ownerToken!==u.token) return ack({ok:false,error:"आप केवल अपना Battle रद्द कर सकते हैं"});
      battles.delete(b.id); publish(); ack({ok:true});
    });
    socket.on("open-battle:start", (d, ack=()=>{}) => {
      const u=sessions.get(socket.id), b=battles.get(d && d.id);
      if(!u) return ack({ok:false,error:"पहले नाम दर्ज करें"});
      if(!b || b.status!=="open") return ack({ok:false,error:"Battle उपलब्ध नहीं है"});
      if(b.ownerToken!==u.token) return ack({ok:false,error:"केवल बनाने वाला खिलाड़ी शुरू कर सकता है"});
      const os=io.sockets.sockets.get(b.ownerId);
      const v=os && sessions.get(b.ownerId);
      if(!os || !v || v.token!==b.ownerToken || v.room) return ack({ok:false,error:"Battle बनाने वाला खिलाड़ी उपलब्ध नहीं है"});
      if(u.room) return ack({ok:false,error:"आप पहले से मैच में हैं"});
      return ack({ok:false,error:"दूसरे खिलाड़ी के जुड़ने पर ही Battle शुरू होगा"});
    });
    socket.on("open-battle:join", (d, ack=()=>{}) => {
      const u=sessions.get(socket.id), b=battles.get(d && d.id);
      if(!u) return ack({ok:false,error:"पहले नाम दर्ज करें"});
      if(u.room) return ack({ok:false,error:"आप पहले से मैच में हैं"});
      if(!b || b.status!=="open") return ack({ok:false,error:"Battle उपलब्ध नहीं है"});
      if(b.ownerToken===u.token) return ack({ok:false,error:"अपने Battle में दूसरा खिलाड़ी जुड़ने दें"});
      const os=io.sockets.sockets.get(b.ownerId), v=os && sessions.get(b.ownerId);
      if(!os || !v || v.token!==b.ownerToken || v.room) return ack({ok:false,error:"Battle बनाने वाला खिलाड़ी उपलब्ध नहीं है"});
      const c=code(),r={code:c,players:[{id:os.id,name:v.name,token:v.token,connected:true},{id:socket.id,name:u.name,token:u.token,connected:true}],state:{turn:0,dice:null,winner:null,pawns:{red:[-1,-1,-1,-1],green:[-1,-1,-1,-1]},message:"दोनों खिलाड़ी जुड़ गए। लाल खिलाड़ी पहले चलेगा"}};
      rooms.set(c,r);v.room=c;u.room=c;os.join(c);socket.join(c);battles.delete(b.id);publish();emit(r);autoTurn.start(r);ack({ok:true,room:view(r)});
    });
  });
};
