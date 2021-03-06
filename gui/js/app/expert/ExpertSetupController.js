/* global angular:false */

angular
.module('ndslabs')
/**
 * The main view of our app, this controller houses the
 * "Deploy" and "Manage" portions of the interface
 * 
 * @author lambert8
 * @see https://opensource.ncsa.illinois.edu/confluence/display/~lambert8/3.%29+Controllers%2C+Scopes%2C+and+Partial+Views
 */
.controller('ExpertSetupController', [ '$scope', '$log', '$interval', '$uibModal', '_', 'AuthInfo', 'Project', 'Volumes', 'Stacks', 'Specs', 
    'DEBUG', 'StackService', 'NdsLabsApi', function($scope, $log, $interval, $uibModal, _, AuthInfo, Project, Volumes, Stacks, Specs, DEBUG, 
    StackService, NdsLabsApi) {
      
  /**
   * Allow the user to dismiss the "welcome banner"
   */ 
  $scope.showWelcomeMessage = true;
  $scope.hideWelcomeMessage = function() {
    $scope.showWelcomeMessage = false;
  };
  
  /**
   * Allow the user to show / hide the volumes slide-out panel
   */ 
  $scope.showVolumePane = false;
  
  $scope.selectVolume = function(volume) {
    $scope.selectedVolume = volume.id;
    $scope.selectedTab = 1;
  };
  
  // Wire in DEBUG mode
  $scope.DEBUG = DEBUG;

  // Accounting stuff
  $scope.counts = {};
  $scope.svcQuery = '';
  $scope.nextId = 1;
  
  // Storage structures
  $scope.currentProject = {};
  $scope.configuredStacks = Stacks.all;
  $scope.configuredVolumes = Volumes.all;
  
  // Helpful stuff
  var projectId = AuthInfo.get().namespace;
  var query = {};
  
  
  // Logic for the "Auto Refresh" toggle button
  $scope.autoInterval = null;
  $scope.startInterval = function (){
    if ($scope.autoInterval === null) {
      $scope.autoInterval = $interval($scope.softRefresh, 2000);
    }
  };
  
  $scope.stopInterval = function() {
    if ($scope.autoInterval !== null) {
      $interval.cancel($scope.autoInterval);
      $scope.autoInterval = null;
    }
  };
  
  $scope.autoRefresh = false;
  $scope.toggleAutoRefresh = function() {
    if ($scope.autoInterval === null) {
      $scope.startInterval();
    } else {
      $scope.stopInterval();
    }
  };
  
  // Watch for transitioning stacks (their status will end with "ing")
  $scope.$watch('configuredStacks', function(oldValue, newValue) {
    var transient = _.find(Stacks.all, function(stk) {
      return _.includes(stk.status, 'ing');
    });
    
    if (transient) {
      $scope.startInterval();
    } else if (!transient) {
      $scope.stopInterval();
    }
  });
  
  /**
   * Perform a "soft-refresh". That is, refresh the data without fully re-rendering the page
   */ 
  $scope.softRefresh = function() {
    /**
     * Grabs metadata about the current project's stacks
     */ 
    (query.stacks = function() {
      // Grab the list of configured stacks in our namespace
      return NdsLabsApi.getProjectsByProjectIdStacks({ 
        "projectId": projectId 
      }).then(function(stacks, xhr) {
        $log.debug("successfully grabbed from /projects/" + projectId + "/stacks!");
        //Stacks.all = stacks || [];
        
        if ($scope.configuredStacks === [] && stacks !== []) {
          // Catch edge case here?
        }
        
        $scope.configuredStacks = Stacks.all = stacks || [];
      }, function(headers) {
        $log.error("error grabbing from /projects/" + projectId + "/stacks!");
      });
    })();
    
    /**
     * Grabs metadata about the current project's volumes
     */ 
    (query.volumes = function() {
      // Grab the list of configured volumes in our namespace
      return NdsLabsApi.getProjectsByProjectIdVolumes({ 
        "projectId": projectId
      }).then(function(volumes, xhr) {
        $log.debug("successfully grabbed from /projects/" + projectId + "/volumes!");
        //Volumes.all = volumes || [];
        Volumes.all = $scope.configuredVolumes = volumes || [];
      }, function(headers) {
        $log.error("error grabbing from /projects/" + projectId + "/volumes!");
      });
    })();
  };
  
  /**
   * Grabs metadata about the current site's available services
   */ 
  (query.services = function() {
    // Grab the list of available services at our site
    return NdsLabsApi.getServices().then(function(specs, xhr) {
      $log.debug("successfully grabbed from /services!");
      Specs.all = $scope.allServices = specs;
      Specs.deps = $scope.deps = angular.copy(specs);
      Specs.stacks = $scope.stacks = _.remove($scope.deps, function(svc) { return svc.stack === true; });
    }, function (headers) {
      $log.error("error grabbing from /services!");
    }).finally(function() {
      $scope.softRefresh();
    });
  })();
  
  /**
   * Grabs metadata about the current project
   */ 
  (query.project = function() {
    // Grab the metadata associated with our current namespace
    return NdsLabsApi.getProjectsByProjectId({ 
      "projectId": projectId 
    }).then(function(project, xhr) {
      $log.debug("successfully grabbed from /projects/" + projectId + "!");
      $scope.project = AuthInfo.project = Project.project = project;
    }, function(headers) {
      $log.debug("error!");
      console.debug(headers);
    })
  })();
  
  $scope.starting = {};
  $scope.stopping = {};
  
  /**
   * Starts the given stack's services one-by-one and does a "soft-refresh" when complete
   * @param {Object} stack - the stack to launch
   */ 
  $scope.startStack = function(stack) {
    $scope.startInterval();
    
    $scope.starting[stack.id] = true;
    
      // Then send the "start" command to the API server
    NdsLabsApi.getProjectsByProjectIdStartByStackId({
      'projectId': projectId,
      'stackId': stack.id
    }).then(function(data, xhr) {
      $log.debug('successfully started ' + stack.name);
    }, function(headers) {
      $log.error('failed to start ' + stack.name);
    }).finally(function() {
      $scope.starting[stack.id] = false;
    });
  };
  
  /**
   * Stops the given stack's services one-by-one and does a "soft-refresh" when complete
   * @param {Object} stack - the stack to shut down
   */ 
  $scope.stopStack = function(stack) {
    // See '/app/expert/modals/stackStop/stackStop.html'
    var modalInstance = $uibModal.open({
      animation: true,
      templateUrl: '/app/expert/modals/stackStop/stackStop.html',
      controller: 'StackStopCtrl',
      size: 'md',
      keyboard: false,
      backdrop: 'static',
      resolve: {
        stack: function() { return stack; },
      }
    });

    // Define what we should do when the modal is closed
    modalInstance.result.then(function(stack) {
      $scope.startInterval();
      
      $scope.stopping[stack.id] = true;
    
      // Then send the "stop" command to the API server
      NdsLabsApi.getProjectsByProjectIdStopByStackId({
        'projectId': projectId,
        'stackId': stack.id
      }).then(function(data, xhr) {
        $log.debug('successfully stopped ' + stack.name);
      }, function(headers) {
        $log.error('failed to stop ' + stack.name);
      })
      .finally(function() {
        $scope.stopping[stack.id] = false;
      });
    });
  };
  
  /** 
   * Checks if a volume exists for the given stack and service and return it if it exists
   * @param {Object} svc - the service to check against the list of volumes
   */
  $scope.showVolume = function(svc) {
    var volume = null;
    angular.forEach($scope.configuredVolumes, function(vol) {
      if (svc.id === vol.attached) {
        volume = vol;
      }
    });

    return volume;
  };
  
  /** 
   * Add a service to a stopped stack 
   * @param {Object} stack - the stack to add the service to
   * @param {Object} service - the new service to add
   */
  $scope.addStackSvc = function(stack, svc) {
    // Add this service to our stack locally
    var spec = _.find(Specs.all, [ 'key', svc.key ]);
    
    // Ensure that adding this service does not require new dependencies
    angular.forEach(spec.depends, function(dependency) {
      var svc = _.find(Specs.all, function(svc) { return svc.key === dependency.key });
      var stackSvc = new StackService(stack, svc);
      
      // Check if this required dependency is already present on our proposed stack
      var exists = _.find(stack.services, function(svc) { return svc.service === dependency.key });
      if (!exists) {
        // Add the service if it has not already been added
        stack.services.push(stackSvc);
      } else {
        // Skip this service if we see it in the list already
        $log.debug("Skipping duplicate service: " + svc.key);
      }
    });
    
    // Now that we have all required dependencies, add our target service
    stack.services.push(new StackService(stack, spec));
    
    // TODO: Should client or server handle this? My gut says server...
    //stack.updatedTime = new Date();
    
    // Then update the entire stack in etcd
    NdsLabsApi.putProjectsByProjectIdStacksByStackId({
      'stack': stack,
      'projectId': projectId,
      'stackId': stack.id
    }).then(function(data, xhr) {
      $log.debug('successfully added service ' + svc.key + ' to stack ' + stack.name);
    }, function(headers) {
      $log.error('failed to add service ' + svc.key + ' to stack ' + stack.name);
      
      // Restore our state from etcd
      query.stacks();
    });
  };
  
  /** 
   * Remove a service from a stopped stack 
   * @param {Object} stack - the stack to remove the service from
   * @param {Object} service - the service to remove
   */
  $scope.removeStackSvc = function(stack, svc) {
    // Remove this services locally
    stack.services.splice(stack.services.indexOf(svc), 1);
    //stack.updatedTime = new Date();
    
    // Then update the entire stack in etcd
    NdsLabsApi.putProjectsByProjectIdStacksByStackId({
      'stack': stack,
      'projectId': projectId,
      'stackId': stack.id
    }).then(function(data, xhr) {
      $log.debug('successfully removed service' + svc.key + '  from stack ' + stack.name);
    }, function(headers) {
      $log.error('failed to remove service ' + svc.key + ' from stack ' + stack.name);
      
      // Restore our state from etcd
      query.stacks();
    });
  };
  
  /**
   * Opens the Configuration Wizard to configure and add a new stack
   * @param {Object} spec - the spec to use to create a new stack
   */ 
  $scope.openWizard = function(spec) {
    // See '/app/expert/modals/configWizard/configurationWizard.html'
    var modalInstance = $uibModal.open({
      animation: true,
      templateUrl: '/app/expert/modals/configWizard/configurationWizard.html',
      controller: 'ConfigurationWizardCtrl',
      size: 'md',
      backdrop: 'static',
      keyboard: false,
      resolve: {
        template: function() { return spec; },
        stacks: function() { return $scope.stacks; },
        deps: function() { return $scope.deps; },
        configuredVolumes: function() { return $scope.configuredVolumes; },
        configuredStacks: function() { return $scope.configuredStacks; }
      }
    });

    // Define what we should do when the modal is closed
    modalInstance.result.then(function(newEntities) {
      $log.debug('Modal accepted at: ' + new Date());
      
      // Create the stack inside our project first
      NdsLabsApi.postProjectsByProjectIdStacks({ 'stack': newEntities.stack, 'projectId': projectId }).then(function(stack, xhr) {
        $log.debug("successfully posted to /projects/" + projectId + "/stacks!");
        
        // Add the new stack to the UI
        Stacks.all.push(stack);
        
          // Then attach our necessary volumes
        if (stack.id) {
          angular.forEach(newEntities.volumes, function(volume) {
            var service = _.find(stack.services, ['service', volume.service]);
            
            if (!volume.id) {
              $scope.createVolume(volume, service);
            } else {
              var orphanVolume = _.find(Volumes.all, function(vol) { return vol.id === volume.id; });
              
              // Attach existing volume to new service
              $scope.attachVolume(orphanVolume, service);
            }
          });
        }
      }, function(headers) {
        $log.error("error posting to /projects/" + projectId + "/stacks!");
      });
    });
  };
  
  $scope.attachVolume = function(volume, service) {
    // We need to PUT to update existing volume
    volume.attached = service.id;
    
    // Attach existing volume to new service
    return NdsLabsApi.putProjectsByProjectIdVolumesByVolumeId({ 
      'volume': volume,
      'volumeId': volume.id,
      'projectId': projectId
    }).then(function(data, xhr) {
      $log.debug("successfully updated /projects/" + projectId + "/volumes/" + volume.id + "!");
      //_.merge(exists, data);
      volume = data;
    }, function(headers) {
      $log.error("error updating /projects/" + projectId + "/volumes/" + volume.id + "!");
    });
  };
  
  $scope.createVolume = function(volume, service) {
    // Volume does not exist, so we need to POST to create it
    volume.attached = service.id;
    return NdsLabsApi.postProjectsByProjectIdVolumes({
      'volume': volume, 
      'projectId': projectId
    }).then(function(data, xhr) {
      $log.debug("successfully posted to /projects/" + projectId + "/volumes!");
      Volumes.all.push(data);
    }, function(headers) {
      $log.error("error posting to /projects/" + projectId + "/volumes!");
    }).finally(function() {
      //$scope.softRefresh();
    });
  };
  
  /**
   * Display a modal window showing running log data for the given service
   * @param {} service - the service to show logs for
   */ 
  $scope.showLogs = function(service) {
    // See '/app/expert/modals/logViewer/logViewer.html'
    $uibModal.open({
      animation: true,
      templateUrl: '/app/expert/modals/logViewer/logViewer.html',
      controller: 'LogViewerCtrl',
      windowClass: 'log-modal-window',
      size: 'lg',
      keyboard: false,      // Force the user to explicitly click "Close"
      backdrop: 'static',   // Force the user to explicitly click "Close"
      resolve: {
        service: function() { return service; },
        projectId: function() { return projectId; }
      }
    });
  };
  
  /**
   * Display a modal window showing running log data for the given service
   * @param {} service - the service to show logs for
   */ 
  $scope.showConfig = function(service) {
    // See '/app/expert/modals/logViewer/logViewer.html'
    $uibModal.open({
      animation: true,
      templateUrl: '/app/expert/modals/configViewer/configViewer.html',
      controller: 'ConfigViewerCtrl',
      size: 'md',
      keyboard: false,      // Force the user to explicitly click "Close"
      backdrop: 'static',   // Force the user to explicitly click "Close"
      resolve: {
        service: function() { return service; }
      }
    });
  };
  
  /**
   * Deletes a stack from etcd, if successful it is removed from the UI.
   * @param {Object} stack - the stack to delete
   * 
   * TODO: If user specifies, also loop through and delete volumes?
   */
  $scope.deleteStack = function(stack) {
    // See '/app/expert/modals/stackDelete/stackDelete.html'
    var modalInstance = $uibModal.open({
      animation: true,
      templateUrl: '/app/expert/modals/stackDelete/stackDelete.html',
      controller: 'StackDeleteCtrl',
      size: 'md',
      keyboard: false,
      backdrop: 'static',
      resolve: {
        stack: function() { return stack; },
      }
    });

    // Define what we should do when the modal is closed
    modalInstance.result.then(function(removeVolumes) {
      $log.debug('Delete Stack Confirmation Modal dismissed at: ' + new Date());
      
      // Delete the stack and orphan the volumes
      NdsLabsApi.deleteProjectsByProjectIdStacksByStackId({
        'projectId': projectId,
        'stackId': stack.id
      }).then(function(data, xhr) {
        $log.debug('successfully deleted stack: ' + stack.name);
        
        $scope.configuredStacks.splice($scope.configuredStacks.indexOf(stack), 1);
        
        var toRemove = [];
        angular.forEach(stack.services, function(service) {
          angular.forEach($scope.configuredVolumes, function(volume) {
            if (volume.attached === service.id) {
              if (removeVolumes) {
                $scope.deleteVolume(volume, true);
              } else {
                volume.attached = "";
              }
            }
          });
        });
      }, function(headers) {
        $log.error('failed to delete stack: ' + stack.name);
      });
    });
  };
  
  /** 
   * Deletes a volume from etcd, if successful it is removed from the UI
   * @param {Object} volume - the volume to delete
   * @param {boolean} [skipConfirm = false] - If true, do not show a 
   *    "Delete Volume" confirmation modal for this operation
   * 
   */
  $scope.deleteVolume = function(volume, skipConfirm) {
    var performDelete = function() {
      NdsLabsApi.deleteProjectsByProjectIdVolumesByVolumeId({
          'projectId': projectId,
          'volumeId': volume.id
        }).then(function(data, xhr) {
          $log.debug('successfully deleted volume: ' + volume.name);
          $scope.configuredVolumes.splice($scope.configuredVolumes.indexOf(volume), 1);
        }, function(headers) {
          $log.error('failed to delete volume: ' + volume.id);
        });
    };
    
    if (skipConfirm) {
      performDelete();
    } else {
      // See '/app/expert/modals/volumeDelete/volumeDelete.html'
      var modalInstance = $uibModal.open({
        animation: true,
        templateUrl: '/app/expert/modals/volumeDelete/volumeDelete.html',
        controller: 'VolumeDeleteCtrl',
        size: 'md',
        keyboard: false,
        backdrop: 'static',
        resolve: {
          volume: function() { return volume; },
        }
      });
      
      // Define what we should do when the modal is closed
      modalInstance.result.then(function(volume) {
        $log.debug('User has chosen to delete volume: ' + volume.id);
        
        performDelete();
      });
    } 
  };
}]);
