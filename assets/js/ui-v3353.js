/* V3.3.53: accessible presentation helper; does not write farm data. */
(function(){
 function setup(){
  const panel=document.getElementById('cloudPanel');
  const newForm=document.getElementById('cloudNewForm');
  const editForm=document.getElementById('cloudEditForm');
  const newBtn=document.getElementById('cloudNewSubmit');
  const editBtn=document.getElementById('cloudSubmit');
  if(!panel||!newForm||!editForm)return;
  function update(){
   const formNew=!newForm.hidden,formEdit=!editForm.hidden;
   const status=document.getElementById('cloudDialogStatus');
   if(status && (formNew||formEdit) && !status.dataset.ui353Original) status.dataset.ui353Original=status.textContent||'';
  }
  const observer=new MutationObserver(update);
  observer.observe(newForm,{attributes:true,attributeFilter:['hidden']});
  observer.observe(editForm,{attributes:true,attributeFilter:['hidden']});
  const who=document.getElementById('cloudWho');if(who)observer.observe(who,{childList:true,subtree:true});
  update();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});else setup();
})();
