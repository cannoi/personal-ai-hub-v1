const appAdapter = {
  knowledge: `
    APP NAME: Example SoloHost App
    MAIN FEATURES: replace this text with real app capabilities.
    USER WORKFLOWS: replace with real workflows.
  `,
  async getContext() {
    return {
      screen: 'home',
      selectedItem: null,
      recentResults: []
    };
  },
  actions: [
    {name:'open_settings', description:'Open the app settings', requiresConfirmation:false},
    {name:'refresh_data', description:'Refresh current data', requiresConfirmation:false}
  ],
  async executeAction(action) {
    if (!['open_settings','refresh_data'].includes(action?.name))
      return {ok:false,error:'Action not allowed'};
    // Call the real app function here.
    return {ok:true, action:action.name};
  }
};

module.exports = appAdapter;
