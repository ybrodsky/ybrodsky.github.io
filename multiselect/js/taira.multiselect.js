'use strict'

angular.module('taira-multiselect', ['ng'])
	.directive('tairaMultiselect', [ '$sce', '$templateCache', function($sce, $templateCache) {
		return {
      restrict: 'AE',
      scope: {
        model: '=',
        options: '=',
        settings: '='
      },
      templateUrl: 'teh-template',
      link: function ($scope, $element, $attrs) {
        //Default values
        $scope._settings = {
          displayFieldType: 'array',
          displayField: ['id'],
          displayFieldPrependHTML: '',
          btnClass: 'btn-primary',
          menuClass: '',
          selectProperty: [],
          btnText: 'Multiselect',
          btnCountSelected: false,
          open: false,
          selectAll: true,
          unselectAll: true,
          showCheckbox: true,
          selectedPrependHTML: '',
        };

        angular.extend($scope._settings, $scope.settings || []);

        if($scope._settings.selectedPrependHTML)
          $scope._settings.selectedPrependHTML = $sce.trustAsHtml($scope._settings.selectedPrependHTML);

        if($scope._settings.displayFieldPrependHTML)
          $scope._settings.displayFieldPrependHTML = $sce.trustAsHtml($scope._settings.displayFieldPrependHTML);

        
        $scope.getDisplayText = function(option) {
          var text = '';

          if($scope._settings.displayFieldType == 'array') {
            $scope._settings.displayField.forEach(function(field) {
              text += option[field] + ' ';
            });  
          }else if($scope._settings.displayFieldType == 'string') {
            text = $scope._settings.displayField;
          }
          
          return text.trim();
        };

        function getSelectPropertyObj(item) {
          var obj = {};

          if(!$scope._settings.selectProperty.length) {
            return angular.copy(item);
          }

          angular.forEach($scope._settings.selectProperty, function(property) {
            obj[property] = item[property];
          });            

          return obj;
        };

        $scope.checkboxClick = function($event, item) {
          $scope.selectItem(item);
          $event.stopImmediatePropagation();
        };

        $scope.selectItem = function(item) {
          item = getSelectPropertyObj(item);
          if(_.findIndex($scope.model, item) !== -1) {
            $scope.model.splice(_.findIndex($scope.model, item), 1);
          }else {
            $scope.model.push(item);
          }
        };

        $scope.isChecked = function(item) {
          item = getSelectPropertyObj(item);
          return _.findIndex($scope.model, item) !== -1;
        };

        $scope.selectAll = function() {
          $scope.unselectAll();
          angular.forEach($scope.options, function(option) {
            $scope.selectItem(option);
          });
        };

        $scope.unselectAll = function() {
          $scope.model = [];
        };
      }
    }
	}]).run(['$templateCache', function($templateCache) {
    var template =
    	'<div class="btn-group" uib-dropdown auto-close="disabled" is-open="_settings.open">' +
			  '<button type="button" class="btn {{_settings.btnClass}}" uib-dropdown-toggle ng-disabled="disabled">' +
			    '{{_settings.btnCountSelected ? (model.length ?  model.length : "none") + " selected" : _settings.btnText}} <span class="caret"></span>' +
			  '</button>' +
			  '<ul class="dropdown-menu {{_settings.menuClass}}" uib-dropdown-menu role="menu" aria-labelledby="single-button">' +
			    '<li ng-if="_settings.selectAll">' +
			      '<a href="" ng-click="selectAll()">Select all</a>' +
			    '</li>' +
			    '<li ng-if="_settings.unselectAll">' +
			      '<a href="" ng-click="unselectAll()">Unselect all</a>' +
			    '</li>' +
			    '<li ng-if="_settings.unselectAll || _settings.selectAll" class="divider"></li>' +
			    '<li ng-repeat="option in options" role="menuitem">' +
			      '<a href="" ng-click="selectItem(option)">' +
			        '<span ng-if="!_settings.showCheckbox && _settings.selectedPrependHTML && isChecked(option)" ng-bind-html="_settings.selectedPrependHTML">' +
			        '</span>' +
			        '<input type="checkbox" ng-if="_settings.showCheckbox" ng-click="checkboxClick($event, option)" ng-checked="isChecked(option)">' +
			        '&nbsp;' +
			        '<span ng-if="_settings.displayFieldPrependHTML" ng-bind-html="_settings.displayFieldPrependHTML"></span>' +
			        '{{getDisplayText(option)}}' +
			      '</a>' +
			    '</li>' +
			  '</ul>' +
			'</div>';

		$templateCache.put('teh-template', template);
  }]);