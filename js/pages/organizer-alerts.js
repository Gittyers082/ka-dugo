document.addEventListener('DOMContentLoaded', () => {
    const $=s=>document.querySelector(s);
    const bloodIds={'A+':1,'A-':2,'B+':3,'B-':4,'AB+':5,'AB-':6,'O+':7,'O-':8};
    const state={bloodType:'O-',radius:15,donors:0};
    const message=$('#alert-message'), dialog=$('.confirm-dialog'), dispatch=$('.dispatch');
    let reachSequence=0, orgName='the community blood donation program', saving=false;
    const toast=(text,error=false)=>{const el=$('.toast');el.textContent=text;el.classList.toggle('error',error);el.classList.add('show');setTimeout(()=>el.classList.remove('show'),5000);};
    async function json(url,options={}) {
        const res=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});
        const data=await res.json();if(!res.ok||!data.success)throw new Error(data.message||'Unable to contact the server.');return data.data;
    }
    function updateMessage(){ $('.counter').textContent=`${message.value.length} / 280`;$('.alert-preview p').textContent=message.value||'Your alert message will appear here.';$('#message-status').textContent=message.value.trim()?'Message ready':'Enter a message'; }
    function reset(){message.value=`URGENT: ${state.bloodType} donors are needed. Eligible donors can open Ka-dugo to view available community blood drives and reserve a slot.`;updateMessage();}
    const estimatedDonorPool=(radius)=>Math.round((Math.PI*radius*radius*4.2)/100)*100;
    async function updateReach(){
        const sequence=++reachSequence;dispatch.disabled=true;state.donors=0;
        $('#reach-count').textContent=`~${estimatedDonorPool(state.radius).toLocaleString()} potential donors`;$('#reach-context').textContent=`Population-based planning estimate within ${state.radius} km.`;$('#eligible-donor-count').textContent='Checking verified in-app recipients…';
        $('.radius-card .tag').textContent=`${state.radius} km radius`;
        $('.radius-input').previousElementSibling.style.left=`${(state.radius-5)/25*100}%`;
        document.querySelectorAll('.range-labels span').forEach(el=>el.classList.toggle('active',parseInt(el.querySelector('b').textContent)===state.radius));
        try {
            const data=await json(`../../api/alerts.php?action=reach&blood_type_id=${bloodIds[state.bloodType]}&radius_km=${state.radius}`);
            if(sequence!==reachSequence)return;
            state.donors=Number(data.count);$('#eligible-donor-count').textContent=`Verified in-app recipients: ${state.donors.toLocaleString()}${data.missing_location?` · ${data.missing_location} location record(s) excluded`:''}.`;
            $('#reach-context').textContent=`Population-based planning estimate within ${state.radius} km of ${data.center_name}.`;
            $('#radius-context').textContent=`Distance is measured from ${data.center_name}, your linked blood bank.`;
            dispatch.disabled=saving||state.donors===0;
        }catch(error){if(sequence!==reachSequence)return;$('#eligible-donor-count').textContent=`Live recipient check unavailable: ${error.message}`;}
    }
    document.querySelectorAll('.blood-grid .blood').forEach(button=>button.addEventListener('click',()=>{
        document.querySelectorAll('.blood-grid .blood').forEach(el=>{el.classList.remove('selected');el.setAttribute('aria-pressed','false');});
        button.classList.add('selected');button.setAttribute('aria-pressed','true');state.bloodType=button.dataset.type;
        $('.notice strong').textContent=`${state.bloodType} donors`;updateReach();
    }));
    $('.radius-input').addEventListener('input',event=>{state.radius=Number(event.target.value);updateReach();});
    message.addEventListener('input',updateMessage);
    $('#alert-form').addEventListener('submit',event=>event.preventDefault());
    $('#reset-protocol').addEventListener('click',()=>{reset();toast('Protocol template restored.');});
    document.querySelectorAll('.close-dialog,.cancel-dialog').forEach(button=>button.addEventListener('click',()=>dialog.close()));
    dispatch.addEventListener('click',()=>{
        if(!message.value.trim())return toast('Enter an alert message.',true);
        if(!$('.delivery-option input[value="push"]').checked)return toast('Select in-app delivery.',true);
        if(!state.donors)return toast('No eligible donors match this selection.',true);
        dialog.showModal();
    });
    async function save(status){
        if(saving)return;
        if(!message.value.trim())return toast('Enter an alert message.',true);
        if(!$('.delivery-option input[value="push"]').checked)return toast('Select in-app delivery.',true);
        saving=true;dispatch.disabled=true;$('#save-draft').disabled=true;$('.approve-dialog').disabled=true;
        try{
            const data=await json('../../api/alerts.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sender_type:'organizer',blood_type_id:bloodIds[state.bloodType],level:2,message:message.value.trim(),status,channel:'push',radius_km:state.radius})});
            dialog.close();toast(status==='draft'?'Draft saved.':`Published to ${data.recipients_notified} donor in-app inbox(es).`);
        }catch(error){toast(error.message,true);}
        finally{saving=false;$('#save-draft').disabled=false;$('.approve-dialog').disabled=false;await updateReach();}
    }
    $('.approve-dialog').addEventListener('click',()=>save('active'));
    $('#save-draft').addEventListener('click',()=>save('draft'));
    $('.refresh').addEventListener('click',updateReach);
    json('../../api/profile.php').then(data=>{orgName=data.org_name;$('.context h2').textContent=orgName;$('.context mark').textContent=`Node #${data.org_code}`;$('.preview-top small').textContent=orgName;}).catch(error=>toast(error.message,true));
    reset();updateReach();
});
