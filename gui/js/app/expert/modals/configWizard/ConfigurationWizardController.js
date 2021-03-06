/* global angular:false */

angular
.module('ndslabs')
/**
 * The Controller for our "Configuration Wizard" Modal Window
 * 
 * @author lambert8
 * @see https://opensource.ncsa.illinois.edu/confluence/display/~lambert8/3.%29+Controllers%2C+Scopes%2C+and+Partial+Views
 */
.controller('ConfigurationWizardCtrl', [ '$scope', '$filter', '$log', '$uibModalInstance', '_', 'NdsLabsApi', 'Project', 'Stack', 'Volume', 
    'StackService', 'Grid', 'Wizard', 'WizardPage', 'template', 'stacks', 'deps', 'configuredStacks', 'configuredVolumes',
    function($scope, $filter, $log, $uibModalInstance, _, NdsLabsApi, Project, Stack, Volume, StackService, Grid, Wizard, WizardPage, template, 
    stacks, deps, configuredStacks, configuredVolumes) {
  $scope.storageQuota = (Project.project.storageQuote || '50' );
  $scope.newStackVolumeRequirements = [];
  
  $scope.discoverVolumeReqs = function(stack) {
    var reusableVolumes = [];
    var requiredVolumes = [];
    angular.forEach(stack.services, function(requestedSvc) {
      var svcSpec = _.find(_.concat(stacks, deps), function(svc) { return svc.key === requestedSvc.service });
      
      // TODO: Gross hack.. fix this
      if (svcSpec.volumeMounts && _.filter(svcSpec.volumeMounts, function(mnt) {
        return mnt.name !== 'docker';
      }).length > 0) {
        var orphan = null;
        angular.forEach(configuredVolumes, function(volume) {
          if (!volume.attached && svcSpec.key === volume.service) {
            // This is an orphaned volume from this service... Prompt the user to reuse it
            orphan = volume;
            reusableVolumes.push(orphan);
          }
        });
        
        var newVolume = new Volume(stack, svcSpec);
        if (orphan !== null) {
          newVolume.id = orphan.id;
          newVolume.name = orphan.name;
        }
        requiredVolumes.push(newVolume);
      }
    });

    $scope.newStackOrphanedVolumes = reusableVolumes;
    $scope.newStackVolumeRequirements = requiredVolumes;
    
    // Select first volume req, if we found any
    if ($scope.newStackVolumeRequirements.length > 0) {
      $scope.volume = $scope.newStackVolumeRequirements[0];
    }
  };

  // TODO: Use queue for recursion?
  $scope.collectDependencies = function(targetSvc) {
    angular.forEach(targetSvc.depends, function(dependency) {
      var key = dependency.key;
      var required = dependency.required;
      var svc = _.find(deps, function(svc) { return svc.key === key });
      var stackSvc = new StackService($scope.newStack, svc);
      var targetArray = null;
      if (required) {
          targetArray = $scope.newStack.services;
      } else {
          targetArray = $scope.newStackOptions;
      }

      // Check if this service is already present on our proposed stack
      var exists = _.find($scope.newStack.services, function(svc) { return svc.service === key });
      if (!exists) {
        // Add the service if it has not already been added
        targetArray.push(stackSvc);
      } else {
        // Skip this service if we see it in the list already
        $log.debug("Skipping duplicate service: " + svc.key);
      }
    });
  };
  
  // The delay (in seconds) before allowing the user to click "Next"
  var initDelay = 0;

  // Define a big pile of logic for our wizard pages
  var configPages = [
    
    // Required Services
    new WizardPage("require", "Required Services", {
        prev: null,
        canPrev: false,
        canNext: function() {
          return $scope.newStack && $scope.newStack.name !== '' 
                    && !_.find(configuredStacks, function(stack) { 
                      return stack.name === $scope.newStack.name;
                    });
        },
        next: function() { 
          if ($scope.newStackOptions.length > 0) {
            return 'options';
          } else if (!_.isEmpty($scope.extraConfig)) {
            return 'config';
          } else if ($scope.newStackVolumeRequirements.length > 0) {
            return 'volumes';
          } else {
            return 'confirm';
          }
        },
        onNext: function() { 
          $scope.discoverVolumeReqs($scope.newStack); 
        }
     }, true),
     
     // Optional Services
     new WizardPage("options", "Select Optional Services", {
        prev: 'require',
        canPrev: true,
        canNext: true,
        onNext: function() {
          $log.debug("Adding optional selections to stack...");
          $scope.newStack.services = angular.copy($scope.newStackRequirements);
          angular.forEach($scope.optionalLinksGrid.selector.selection, function(option) {
            var svc = _.find(deps, function(svc) { return svc.key === option.service });
            $scope.collectDependencies(svc);
            $scope.newStack.services.push(new StackService($scope.newStack, svc));
          });

          $log.debug("Discovering volume requirements...");
          $scope.discoverVolumeReqs($scope.newStack);
          
          /*var services = _.map($scope.newStack.services, 'service');
          debugger;
          NdsLabsApi.getConfigs({ 'services': services}).then(function(data, headers) {
            $scope.extraConfig = data;
          }, function() {
            $log.error('Failed to grab custom config for ' + services);
          });*/
          
          $scope.extraConfig = {};
          angular.forEach($scope.newStack.services, function(svc) {
            var spec = _.find(_.concat(stacks, deps), [ 'key', svc.service ]);
            
            // Don't modify specs in-place... make a copy
            if (spec.config) {
              $scope.extraConfig[svc.service] = {
                list: angular.copy(spec.config),
                defaults: angular.copy(spec.config)
              };
            }
          });
        },
        next: function() { 
          console.debug($scope.newStackVolumeRequirements);
          if (!_.isEmpty($scope.extraConfig)) {
            $log.debug('Going to config');
            return 'config';
          } else if ($scope.newStackVolumeRequirements.length > 0) {
            $log.debug('Going to volumes');
            return 'volumes';
          } else {
            $log.debug('Going to confirm');
            return 'confirm';
          }
        }
     }, true),
     
     // Additional Service Configuration
     new WizardPage("config", "Additional Configuration Required", {
        prev: function() {
          if ($scope.newStackOptions.length > 0) {
            $log.debug('Going to options');
            return 'options';
          } else {
            $log.debug('Going to requirements');
            return 'require';
          }
        },
        canPrev: true,
        canNext: function() {
          var canNext = true;
          angular.forEach($scope.extraConfig, function(configs, svcKey) {
            angular.forEach(configs.list, function(cfg) {
              if (cfg.value === '' && cfg.canOverride === true) {
                canNext = false;
              }
            });
          });
          return canNext;
        },
        onNext: function() {
          angular.forEach($scope.extraConfig, function(config, svcKey) {
            // Locate our target service
            var svc = _.find($scope.newStack.services, [ 'service', svcKey ]);
            
            // Accumulate config name-value pairs
            svc.config = {};
            angular.forEach(config.list, function(cfg) {
              svc.config[cfg.name] = cfg.value;
            });
          });
        },
        next: function() { 
          console.debug($scope.newStackVolumeRequirements);
          if ($scope.newStackVolumeRequirements.length > 0) {
            $log.debug('Going to volumes');
            return 'volumes';
          } else {
            $log.debug('Going to confirm');
            return 'confirm';
          }
        }
     }, true),
     
     // Configure Volumes
     new WizardPage("volumes", "Configure Volumes", {
        prev: function() {
          if (!_.isEmpty($scope.extraConfig)) {
            $log.debug('Going to config');
            return 'config';
          } else if ($scope.newStackOptions.length > 0) {
            $log.debug('Going to options');
            return 'options';
          } else {
            $log.debug('Going to requirements');
            return 'require';
          }
        },
        canPrev: true,
        canNext: function() {
          var used = $filter('usedStorage')(configuredVolumes);
          if (used == $scope.storageQuota) {
            // No room for any new volumes
            return false;
          }
      
          // Don't count orphaned volumes in our requested total (they are already part of "used")
          var diff = _.differenceBy($scope.newStackVolumeRequirements, configuredVolumes, 'id');
          var requested = $filter('usedStorage')(diff);
          var available = $scope.storageQuota - used;
          if (requested > available) {
            return false;
          }
          
          var volumeParamsSet = true;
          angular.forEach($scope.newStackVolumeRequirements, function(volume) {
            // Check that all of our required parameters have been set
              if (!volume.id && !volume.name) {
                volumeParamsSet = false;
                return;
              } else if (!volume.size || !volume.sizeUnit) {
                volumeParamsSet = false;
                return;
              }
          });
          return volumeParamsSet;
        },
        next: 'confirm',
        onNext: function() {
          $log.debug("Verifying that user has made valid 'Volume' selections...");
        }
     }, true),
     
     // Confirm New Stack
     new WizardPage("confirm", "Confirm New Stack", {
        prev: function() {
          if ($scope.newStackVolumeRequirements.length > 0) {
            $log.debug('Going back to volumes');
            return 'volumes';
          } else if (!_.isEmpty($scope.extraConfig)) {
            $log.debug('Going back to config');
            return 'config';
          } else if ($scope.newStackOptions.length > 0) {
            $log.debug('Going back to options');
            return 'options';
          } else {
            $log.debug('Going back to requirements');
            return 'require';
          }
        },
        canPrev: true,
        canNext: false,
        next: null
     }, true)
  ];
  
  // Create a new Wizard to display
  $scope.wizard = new Wizard(configPages, initDelay);
  
  $scope.spec = template;
  $scope.newStack = new Stack(template);
  $scope.newStackLabel = template.label;
  $scope.newStackOptions = [];
  var pageSize = 100;
  $scope.optionalLinksGrid = new Grid(pageSize, function() { return $scope.newStackOptions; });

  // Add our base service to the stack
  var base = _.find(_.concat(deps, stacks), function(svc) { return svc.key === template.key });
  $scope.newStack.services.push(new StackService($scope.newStack, base));

  // Add required dependencies to the stack
  $scope.collectDependencies(template);
  $scope.newStackRequirements = $scope.newStack.services;
  
  // Gather requirements of optional components
  $scope.newStackOptionalDeps = {};
  angular.forEach($scope.newStackOptions, function(opt) {
    var spec = _.find(deps, function(service) { return service.key === opt.service });
    var required = [];
    angular.forEach(spec.depends, function(dep) {
      if (dep.required === true) {
        required.push(dep.key);
      }
    });
    $scope.newStackOptionalDeps[opt.service] = required;
  });
  
  
  // Pager for multiple volume requirements
  $scope.currentPage = 0;
  $scope.getPageRange = function() {
    return [ $scope.currentPage-2, $scope.currentPage-1, $scope.currentPage, $scope.currentPage+1, $scope.currentPage+2 ];
  };
  $scope.setCurrentPage = function(newPage) {
    $scope.currentPage = newPage;
    $scope.volume = $scope.newStackVolumeRequirements[newPage];
  };
  
  $scope.project = Project.project;
  $scope.storageQuota = Project.storageQuota || 50;
  $scope.configuredVolumes = configuredVolumes;
  
  // TODO: Where is this email address going to live?
  var adminEmail = 'site-admin';
  var subject = $filter('urlEncode')('Increasing My Storage Quota');
  var body = $filter('urlEncode')('Hello, Admin! I appear to have reach my storage limit of '
              + $scope.storageQuota + ' GB on ' + Project.namespace 
              + '. Could we please discuss options for increasing the ' 
              + 'storage quota of this project? Thank you! --' + Project.namespace);
  $scope.mailToLink = 'mailto:' + adminEmail 
                      + '?subject=' + subject
                      + '&body=' + body;
    
  // TODO: Add this field to the backend
  // Assumption: quota is in GB
  // Assumption: GB is lowest denomination

  var available = angular.copy($scope.storageQuota);

  $scope.availableSpace = available;
  $scope.usedSpace = $scope.storageQuota - available;
  
  $scope.ok = function () {
    $log.debug("Closing modal with success!");
    $uibModalInstance.close({ 'stack': $scope.newStack, 'volumes': $scope.newStackVolumeRequirements });
  };

  $scope.close = function () {
    $log.debug("Closing modal with dismissal!");
    $uibModalInstance.dismiss('cancel');
  };
}]);
