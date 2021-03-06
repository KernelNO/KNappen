﻿/// <reference path="_References.ts" />
/// <reference path="../../Scripts/typings/knockout/knockout.d.ts" />

module App {

    /**
      * Application settings. User settings that will be saved/loaded to local storage.
      * @class
      */
    export class Settings {

        public onPreLoad = new System.Utils.Event("Settings.PreLoad");
        public onPostLoad = new System.Utils.Event("Settings.PostLoad");
        public onPreSave = new System.Utils.Event("Settings.PreSave");
        public onPostSave = new System.Utils.Event("Settings.PostSave");

        public mapTypes: KnockoutObservableArray;
        public mapZoomLevels: KnockoutObservableArray;
        public searchDistances: KnockoutObservableArray;
        public resultAmounts: KnockoutObservableArray;
        public views: KnockoutObservableArray;

        //public startSearchCategory: KnockoutObservableString = ko.observable('*');
        public startSearchCategory: KnockoutObservableString = ko.observable('*');
        public startSearchDistance: KnockoutObservableNumber = ko.observable(1);
        //public startMapType: KnockoutObservableString = ko.observable('WMS:std0:norges_grunnkart');
        public startMapType: KnockoutObservableString = ko.observable('OSM');
        public startMapZoomLevel: KnockoutObservableNumber = ko.observable(14);
        public startResultAmount: KnockoutObservableNumber = ko.observable(30);
        public startView: KnockoutObservableString = ko.observable('homeView');

        public adminPassword: KnockoutObservableString = ko.observable('');
        public disableCaching: KnockoutObservableBool = ko.observable(false);

        constructor() {
        }

        public PreInit() {
            log.debug("Settings", "PreInit()");

            // Load settings if we have any
            this.load();
        }

        public save() {
            this.onPreSave.trigger('PreSave');
            serializer.serializeKnockoutObjectToFile("Settings", this);
            this.onPostSave.trigger('PostSave');
        }

        public load(): bool {
            this.onPreLoad.trigger('PreLoad');
            var ret = serializer.deserializeKnockoutObjectFromFile("Settings", this);
            this.setOverrides();
            this.onPostLoad.trigger('PostLoad');
            return ret;
        }

        private setOverrides() {
            this.mapTypes = ko.observableArray([
                //{ id: "GoogleStreets", name: "Google Streets" },
                //{ id: "GooglePhysical", name: "Google Physical" },
                //{ id: "GoogleHybrid", name: "Google Hybrid" },
                //{ id: "GoogleSatellite", name: "Google Satellite" },
                { id: "OSM", name: "OpenStreetMap" },
                { id: "WMS:std0:norges_grunnkart", name: "Norges grunnkart" },
                { id: "WMS:std0:topo2", name: "Topologisk" },
                { id: "BingRoad", name: "Bing Road" },
                { id: "BingHybrid", name: "Bing Hybrid" },
                { id: "BingAerial", name: "Bing Aerial" }

            //{ id: "nib0:NiB", name: "Flyfoto" },
            //{ id: "WMTS:nib0:NiB", name: "Flyfoto" },
            ]);


            this.mapZoomLevels = ko.observableArray(
                [
                { id: 7, name: "7 (country)" },
                { id: 8, name: "8" },
                { id: 9, name: "9" },
                { id: 10, name: "10 (county)" },
                { id: 11, name: "11" },
                { id: 12, name: "12" },
                { id: 13, name: "13 (city)" },
                { id: 14, name: "14" },
                { id: 15, name: "15" },
                { id: 15, name: "16" },
                { id: 15, name: "17" },
                { id: 15, name: "18 (street)" }
                ]);

            this.searchDistances = ko.observableArray([
                { id: 0.05, name: "50 meter" },
                { id: 0.1, name: "100 meter" },
                { id: 0.2, name: "200 meter" },
                { id: 0.3, name: "300 meter" },
                { id: 0.5, name: "500 meter" },
                { id: 0.75, name: "750 meter" },
                { id: 1, name: "1 km" },
                { id: 1.5, name: "1,5 km" },
                { id: 2, name: "2 km" },
                { id: 3, name: "3 km" },
                { id: 5, name: "5 km" },
                { id: 10, name: "1 mil" },
                { id: 20, name: "2 mil" },
                { id: 50, name: "5 mil" },
                { id: 100, name: "10 mil" },
                //{ id: 0, name: "Alt" }
            ]);

            this.resultAmounts = ko.observableArray([
                { id: 10, name: "10" },
                { id: 25, name: "25" },
                { id: 50, name: "50" },
                { id: 75, name: "75" },
                { id: 100, name: "100" },
            ]);

            //Removed this because of a bug we didn't have time to fix
            //{ id: "arView", name: "Utvidet virkelighet" }
            this.views = ko.observableArray([
                { id: "mapView", name: "Map" },
                { id: "listView", name: "Search Result" },
            ]);

        }
      
        //this.searchCategories = ko.observableArray([
        //    { id: "mapView", name: "Kart" },
        //    { id: "listView", name: "Søkeresultat" },
        //    { id: "arView", name: "Utvidet virkelighet" }
        //]);
    
    }

}
var settings = new App.Settings();
startup.addPreInit(function () { settings.PreInit(); });