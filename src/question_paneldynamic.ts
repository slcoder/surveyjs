import {IElement, Base, ISurveyData, ISurvey, ISurveyImpl, HashTable, ITextProcessor} from "./base";
import {surveyLocalization} from "./surveyStrings";
import {ILocalizableOwner, LocalizableString} from "./localizablestring";
import {TextPreProcessor} from "./textPreProcessor";
import {ProcessValue} from "./conditionProcessValue";
import {Question} from "./question";
import {PanelModel} from "./panel";
import {JsonObject} from "./jsonobject";
import {QuestionFactory} from "./questionfactory";

export interface IQuestionPanelDynamicData {
    getPanelItemData(item: QuestionPanelDynamicItem): any;
    setPanelItemData(item: QuestionPanelDynamicItem, name: string, val: any);
    getSurvey(): ISurvey;
}

export class QuestionPanelDynamicItem implements ISurveyData, ISurveyImpl, ITextProcessor {
    public static ItemVariableName = "panel";
    private panelValue: PanelModel;
    private data: IQuestionPanelDynamicData;
    private textPreProcessor = new TextPreProcessor();
    constructor(data: IQuestionPanelDynamicData, panel: PanelModel) {
        this.data = data;
        this.panelValue = panel;
        this.panel.setSurveyImpl(this);
        var self = this;
        this.textPreProcessor = new TextPreProcessor();
        this.textPreProcessor.onHasValue = function (name: string) { return self.hasProcessedTextValue(name); };
        this.textPreProcessor.onProcess = function (name: string, returnDisplayValue: boolean) { return self.getProcessedTextValue(name, returnDisplayValue); };
    }
    public get panel(): PanelModel { return this.panelValue; }
    public runCondition(values: HashTable<any>) {
        this.panel.runCondition(values);
    }
    public getValue(name: string): any {
        var values = this.data.getPanelItemData(this);
        return values[name];
    }
    public setValue(name: string, newValue: any) {
        this.data.setPanelItemData(this, name, newValue);
    }
    public getComment(name: string): string {
        var result = this.getValue(name + Base.commentPrefix);
        return result ? result : "";
    }
    public setComment(name: string, newValue: string) {
        this.setValue(name + Base.commentPrefix, newValue);
    }
    public onSurveyValueChanged() {
        var questions = this.panel.questions;
        var values = this.data.getPanelItemData(this);
        for(var i = 0; i < questions.length; i ++) {
            var q = questions[i];
            q.onSurveyValueChanged(values[q.name]);
        }
    }

    getAllValues() : any { return this.data.getPanelItemData(this); }
    geSurveyData(): ISurveyData { return this; }
    getSurvey(): ISurvey { return this.data ? this.data.getSurvey() : null; }
    getTextProcessor(): ITextProcessor { return this; }
    //ITextProcessor 
    private hasProcessedTextValue(name: string): boolean {
        var firstName = new ProcessValue().getFirstName(name);
        return firstName == QuestionPanelDynamicItem.ItemVariableName;
    }
    private getProcessedTextValue(name: string, returnDisplayValue: boolean) {
        //name should start with the panel
        name = name.replace(QuestionPanelDynamicItem.ItemVariableName + ".", "");
        var firstName = new ProcessValue().getFirstName(name);
        var question = <Question>this.panel.getQuestionByName(firstName);
        if(!question) return null;
        var values = {};
        values[firstName] = returnDisplayValue ? question.displayValue : question.value;
        return new ProcessValue().getValue(name, values);
    }
    processText(text: string, returnDisplayValue: boolean): string {
        text = this.textPreProcessor.process(text, returnDisplayValue);
        var survey = this.getSurvey();
        return survey ? survey.processText(text, returnDisplayValue) : text;
    }
    processTextEx(text: string): any {
        text = this.processText(text, true);
        var survey = this.getSurvey();
        return survey ? survey.processTextEx(text) : text;
    }
    onAnyValueChanged(name: string) {
        this.panel.onAnyValueChanged(name);
        this.panel.onAnyValueChanged(QuestionPanelDynamicItem.ItemVariableName);
    }
}

export class QuestionPanelDynamicModel extends Question implements IQuestionPanelDynamicData {
    public static MaxPanelCount = 100;
    private templateValue: PanelModel;
    private itemsValue: Array<QuestionPanelDynamicItem> = new Array<QuestionPanelDynamicItem>();
    private loadingPanelCount: number = 0;
    private minPanelCountValue = 0;
    private maxPanelCountValue = QuestionPanelDynamicModel.MaxPanelCount;
    private locAddPanelTextValue: LocalizableString;
    private locRemovePanelTextValue: LocalizableString;
    private isValueChangingInternally: boolean;
    private oldTemplateRowsChangedCallback: any;

    panelCountChangedCallback: () => void;

    constructor(public name: string) {
        super(name);
        this.templateValue = this.createNewPanelObject();
        this.template.renderWidth = "100%";
        this.template.selectedElementInDesign = this;
        var self = this;
        this.oldTemplateRowsChangedCallback = this.template.rowsChangedCallback;
        this.template.rowsChangedCallback = function() { self.templateOnRowsChanged(); if(self.oldTemplateRowsChangedCallback) self.oldTemplateRowsChangedCallback(); }
        this.locAddPanelTextValue = new LocalizableString(this);
        this.locRemovePanelTextValue = new LocalizableString(this);
    }
    private templateOnRowsChanged() {
        if(this.isLoadingFromJson) return;
        this.rebuildPanels();
    }
    public getType(): string {
        return "paneldynamic";
    }
    public get template(): PanelModel { return this.templateValue; }
    public get templateElements(): Array<IElement> { return this.template.elements; }
    public get templateTitle(): string { return this.template.title; }
    public set templateTitle(newValue: string) {
        this.template.title = newValue;
    }
    get locTemplateTitle(): LocalizableString { return this.template.locTitle; }

    protected get items(): Array<QuestionPanelDynamicItem> { return this.itemsValue; }
    public get panels(): Array<PanelModel> {
        var res = [];
        for(var i = 0; i < this.items.length; i ++) {
            res.push(this.items[i].panel);
        }
        return res;
    }
    public getElementsInDesign(includeHidden: boolean = false): Array<IElement> { return includeHidden ? [this.template] : this.templateElements; }
    public get panelCount(): number { return this.isLoadingFromJson ? this.loadingPanelCount : this.items.length; }
    public set panelCount(val: number) {
        if(val < 0) return;
        if(this.isLoadingFromJson) {
            this.loadingPanelCount = val;
            return;
        }
        if(val == this.items.length || this.isDesignMode) return;
        for(let i = this.panelCount; i < val; i ++) {
            this.items.push(this.createNewItem());
        }
        if(val < this.panelCount) this.items.splice(val, this.panelCount - val);
        this.setValueBasedOnPanelCount();
        this.reRunCondition();
        this.fireCallback(this.panelCountChangedCallback);
    }
    private setValueBasedOnPanelCount() {
        var value = this.value;
        if(!value || !Array.isArray(value)) value = [];
        if(value.length == this.panelCount) return;
        for(var i = value.length; i < this.panelCount; i ++) value.push({});
        if(value.length > this.panelCount) value.splice(this.panelCount, value.length - this.panelCount);
        this.value = value;
    }
    public get minPanelCount() : number { return this.minPanelCountValue; }
    public set minPanelCount(value : number) {
        if(value < 0) value = 0;
        if(value == this.minPanelCount || value > this.maxPanelCount) return;
        this.minPanelCountValue = value;
        if(this.panelCount < value) this.panelCount = value;
    }
    public get maxPanelCount() : number { return this.maxPanelCountValue; }
    public set maxPanelCount(value : number) {
        if(value <= 0) return;
        if(value > QuestionPanelDynamicModel.MaxPanelCount) value = QuestionPanelDynamicModel.MaxPanelCount;
        if(value == this.maxPanelCount || value < this.minPanelCount) return;
        this.maxPanelCountValue = value;
        if(this.panelCount > value) this.panelCount = value;
    }
    public get canAddPanel() : boolean { return this.panelCount < this.maxPanelCount; }
    public get canRemovePanel() : boolean { return this.panelCount > this.minPanelCount; }
    public get addPanelText() { return this.locAddPanelText.text ? this.locAddPanelText.text : surveyLocalization.getString("addPanel"); } 
    public set addPanelText(value: string) { this.locAddPanelText.text = value; }
    get locAddPanelText() { return this.locAddPanelTextValue; }
    /**
     * Use this property to change the default value of remove row button text.
     */
    public get removePanelText() { return this.locRemovePanelText.text ? this.locRemovePanelText.text : surveyLocalization.getString("removePanel"); } 
    public set removePanelText(value: string) { this.locRemovePanelText.text = value; }
    get locRemovePanelText() { return this.locRemovePanelTextValue; }

    protected rebuildPanels() {
        var items = new Array<QuestionPanelDynamicItem>();
        if(this.isDesignMode) {
            items.push(new QuestionPanelDynamicItem(this, this.template));
            if(this.oldTemplateRowsChangedCallback) {
                this.oldTemplateRowsChangedCallback();
            }
        } else {
            for(var i = 0; i  < this.panelCount; i ++) {
                items.push(this.createNewItem());
            }
        }
        this.itemsValue = items;
        this.reRunCondition();
        this.fireCallback(this.panelCountChangedCallback);
    }
    public addPanel(): PanelModel {
        if(!this.canAddPanel) return null;
        this.panelCount ++;
        return this.items[this.panelCount - 1].panel;
    }
    public removePanel(value: any) {
        if(!this.canRemovePanel) return;
        var index = this.getPanelIndex(value);
        if(index < 0 || index >= this.panelCount) return;
        this.items.splice(index, 1);
        var value = this.value;
        if(!value || !Array.isArray(value) || index >= value.length) return;
        value.splice(index, 1);
        this.value = value;
        this.fireCallback(this.panelCountChangedCallback);
    }
    private getPanelIndex(val: any): number {
        if(!isNaN(parseFloat(val)) && isFinite(val)) return val;
        for(var i = 0; i < this.items.length; i ++) {
            if(this.items[i] === val || this.items[i].panel === val) return i;
        }
        return -1;
    }
    public onSurveyLoad() {
        if(this.loadingPanelCount > 0) {
            this.panelCount = this.loadingPanelCount;
        }
        if(this.isDesignMode) {
            this.rebuildPanels();
        }
        super.onSurveyLoad();
    }
    public runCondition(values: HashTable<any>) {
        super.runCondition(values);
        this.runPanelsCondition(values);
    }
    private reRunCondition() {
        if(!this.data) return;
        this.runCondition(this.data.getAllValues());
    }
    protected runPanelsCondition(values: HashTable<any>) {
        var newValues = {};
        if (values && values instanceof Object) {
            newValues = JSON.parse(JSON.stringify(values));
        }
        for(var i = 0; i < this.items.length; i ++) {
            newValues[QuestionPanelDynamicItem.ItemVariableName] = this.getPanelItemData(this.items[i]);
            this.items[i].runCondition(newValues);
        }
    }
    onAnyValueChanged(name: string) {
        super.onAnyValueChanged(name);
        for(var i = 0; i < this.items.length; i ++) {
            this.items[i].onAnyValueChanged(name);
        }
    }
    public hasErrors(fireCallback: boolean = true): boolean {
        var errosInPanels = this.hasErrorInPanels(fireCallback);
        return super.hasErrors(fireCallback) || errosInPanels;
    }
    private hasErrorInPanels(fireCallback: boolean): boolean {
        var res = false;
        var panels = this.panels;
        for (var i = 0; i < panels.length; i++) {
            res = panels[i].hasErrors(fireCallback) || res;
        }
        return res;
    }
    protected createNewItem(): QuestionPanelDynamicItem {
        return new QuestionPanelDynamicItem(this, this.createNewPanel());
    }
    protected createNewPanel(): PanelModel {
        var panel = this.createNewPanelObject();
        var jObj = new JsonObject();
        var json = jObj.toJsonObject(this.template);
        jObj.toObject(json, panel);
        panel.renderWidth = "100%";
        return panel;
    }   
    protected createNewPanelObject(): PanelModel {
        return new PanelModel();
    }
    protected onValueChanged() {
        if(this.isValueChangingInternally) return;
        var val = this.value;
        var newPanelCount = val && Array.isArray(val) ? val.length : 0;
        if (newPanelCount <= this.panelCount) return;
        this.panelCount = newPanelCount;
    }
    public onSurveyValueChanged(newValue: any) {
        super.onSurveyValueChanged(newValue);
        for(var i = 0; i < this.items.length; i ++) {
            this.items[i].onSurveyValueChanged();
        }
    }
    protected onSetData() { 
        super.onSetData();
        if(this.isDesignMode) {
            this.template.setSurveyImpl(this.surveyImpl);
            if(!this.isLoadingFromJson) {
                this.rebuildPanels();
            }
        }
    }
    //IQuestionPanelDynamicData 
    getPanelItemData(item: QuestionPanelDynamicItem): any {
        var index = this.items.indexOf(item);
        if(index < 0) return {};
        var qValue = this.value;
        if(!qValue || !Array.isArray(qValue) || qValue.length <= index) return {};
        return qValue[index];
    }
    setPanelItemData(item: QuestionPanelDynamicItem, name: string, val: any) {
        var index = this.items.indexOf(item);
        if(index < 0) return;
        var qValue = this.value;
        if(!qValue || !Array.isArray(qValue) || qValue.length <= index) return;
        if(!qValue[index]) qValue[index] = {};
        qValue[index][name] = val;
        this.isValueChangingInternally = true;
        this.value = qValue;
        this.isValueChangingInternally = false;
    }
    getSurvey(): ISurvey { return this.survey; }
}

JsonObject.metaData.addClass("paneldynamic", [{name: "templateElements", alternativeName: "questions", visible: false}, 
    {name: "templateTitle:text", serializationProperty: "locTemplateTitle"}, {name: "panelCount:number", default: 0, choices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]},
    { name: "minPanelCount:number", default: 0 }, { name: "maxPanelCount:number", default: QuestionPanelDynamicModel.MaxPanelCount },
    { name: "addPanelText", serializationProperty: "locAddPanelText" }, { name: "removePanelText", serializationProperty: "locRemovePanelText" }],
    function () { return new QuestionPanelDynamicModel(""); }, "question");
QuestionFactory.Instance.registerQuestion("paneldynamic", (name) => { return new QuestionPanelDynamicModel(name);  });