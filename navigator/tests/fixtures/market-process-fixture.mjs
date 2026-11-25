process.on('disconnect',()=>process.exit(0));
process.on('message',({id,source,input})=>{
 if(input.settlement==='crash')process.exit(23);
 if(input.settlement==='hang')return;
 process.send({id,result:{source,status:'schema_unknown',connected:false,listings:[],message:'Fixture only'}});
});
