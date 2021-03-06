// Copyright © 2016 National Data Service
package kube

import (
	"bytes"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"github.com/golang/glog"
	ndsapi "github.com/ndslabs/apiserver/types"
	"io/ioutil"
	"k8s.io/kubernetes/pkg/api"
	"k8s.io/kubernetes/pkg/api/unversioned"
	intstr "k8s.io/kubernetes/pkg/util/intstr"
	utilrand "k8s.io/kubernetes/pkg/util/rand"
	"net/http"
	"strings"
	"time"
)

var apiBase = "/api/v1"

type ServiceAddrPort struct {
	Name     string
	Host     string
	Port     int
	NodePort int
}

type KubeHelper struct {
	kubeBase  string
	basicAuth string
	client    *http.Client
}

func NewKubeHelper(kubeBase string, username string, password string) *KubeHelper {
	tr := &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}

	auth := fmt.Sprintf("%s:%s", username, password)

	return &KubeHelper{
		kubeBase:  kubeBase,
		basicAuth: base64.StdEncoding.EncodeToString([]byte(auth)),
		client:    &http.Client{Transport: tr},
	}
}

func (k *KubeHelper) CreateNamespace(pid string) (*api.Namespace, error) {

	// Create the K8 namespace
	ns := api.Namespace{}
	ns.SetName(pid)

	data, err := json.Marshal(ns)
	if err != nil {
		return nil, err
	}

	url := k.kubeBase + apiBase + "/namespaces"
	glog.V(4).Infoln(url)
	request, _ := http.NewRequest("POST", url, bytes.NewBuffer(data))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", fmt.Sprintf("Basic %s", k.basicAuth))
	httpresp, httperr := k.client.Do(request)
	if httperr != nil {
		glog.Error(httperr)
		return nil, httperr
	} else {
		if httpresp.StatusCode == http.StatusCreated {
			glog.V(2).Infof("Added namespace %s\n", pid)
			data, err := ioutil.ReadAll(httpresp.Body)
			if err != nil {
				return nil, err
			}

			json.Unmarshal(data, &ns)
			return &ns, nil
		} else if httpresp.StatusCode == http.StatusConflict {
			return nil, fmt.Errorf("Namespace exists for project %s: %s\n", pid, httpresp.Status)
		} else {
			return nil, fmt.Errorf("Error adding namespace for project %s: %s\n", pid, httpresp.Status)
		}
	}
	return nil, nil
}

func (k *KubeHelper) DeleteNamespace(pid string) (*api.Namespace, error) {

	url := k.kubeBase + apiBase + "/namespaces/" + pid
	glog.V(4).Infoln(url)
	request, _ := http.NewRequest("DELETE", url, nil)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", fmt.Sprintf("Basic %s", k.basicAuth))
	httpresp, httperr := k.client.Do(request)
	if httperr != nil {
		glog.Error(httperr)
		return nil, httperr
	} else {
		if httpresp.StatusCode == http.StatusOK {
			glog.V(2).Infof("Deleted namespace %s\n", pid)
			data, err := ioutil.ReadAll(httpresp.Body)
			if err != nil {
				return nil, err
			}

			ns := api.Namespace{}
			json.Unmarshal(data, &ns)
			return &ns, nil
		} else {
			return nil, fmt.Errorf("Error deleting namespace for project %s: %s\n", pid, httpresp.Status)
		}
	}
	return nil, nil
}

// Start the specified replication controller
func (k *KubeHelper) StartController(pid string, spec *api.ReplicationController) (bool, error) {

	name := spec.Labels["name"]

	// Get ReplicationController spec
	data, err := json.MarshalIndent(spec, "", "    ")
	if err != nil {
		return false, err
	}

	fmt.Println(string(data))

	url := k.kubeBase + apiBase + "/namespaces/" + pid + "/replicationcontrollers"
	request, _ := http.NewRequest("POST", url, bytes.NewBuffer([]byte(data)))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", fmt.Sprintf("Basic %s", k.basicAuth))
	httpresp, httperr := k.client.Do(request)
	if httperr != nil {
		glog.Error(httperr)
		return true, httperr
	} else {
		if httpresp.StatusCode == http.StatusCreated {
			glog.V(4).Infof("Created controller " + name)
		} else {
			glog.V(4).Infof("Error starting controller (%d)\n", httpresp.StatusCode)
		}
	}

	// Give Kubernetes time to create the pods for the RC
	time.Sleep(time.Second * 5)

	// Wait for pods in ready state
	ready := 0
	pods, _ := k.GetPods(pid, "rc", name)
	glog.V(4).Infof("Waiting for %d pod to be ready %s\n", len(pods), name)
	for ready < len(pods) {
		for _, pod := range pods {
			if len(pod.Status.Conditions) > 0 {
				condition := pod.Status.Conditions[0]
				phase := pod.Status.Phase
				containerState := ""
				if len(pod.Status.ContainerStatuses) > 0 {
					state := pod.Status.ContainerStatuses[0].State
					switch {
					case state.Running != nil:
						containerState = "running"
					case state.Waiting != nil:
						containerState = "waiting"
					case state.Terminated != nil:
						containerState = "terminated"
					}
				}

				glog.V(4).Infof("Waiting for pod %s (%s=%s) [%s, %#v]\n", pod.Name, condition.Type, condition.Status, phase, containerState)

				if condition.Type == "Ready" && condition.Status == "True" {
					ready++
				} else {
					pods, _ = k.GetPods(pid, "rc", name)
					time.Sleep(time.Second * 2)
				}
			}
		}
	}
	return true, nil
}

func (k *KubeHelper) StartService(pid string, spec *api.Service) (*api.Service, error) {

	name := spec.Name

	data, err := json.MarshalIndent(spec, "", "    ")
	if err != nil {
		return nil, err
	}
	fmt.Println(string(data))

	url := k.kubeBase + apiBase + "/namespaces/" + pid + "/services"
	request, _ := http.NewRequest("POST", url, bytes.NewBuffer(data))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", fmt.Sprintf("Basic %s", k.basicAuth))
	httpresp, httperr := k.client.Do(request)
	if httperr != nil {
		glog.Error(httperr)
		return nil, httperr
	} else {
		if httpresp.StatusCode == http.StatusCreated {
			glog.V(4).Infof("Created Kubernetes service " + name)

			data, err := ioutil.ReadAll(httpresp.Body)
			if err != nil {
				return nil, err
			}

			service := api.Service{}
			json.Unmarshal(data, &service)

			return &service, nil
		} else {
			glog.Warningf("Error starting Kubernetes service (%d): %s\n", httpresp.StatusCode, httpresp.Status)
		}
	}
	return nil, nil
}

func (k *KubeHelper) GetServices(pid string, stack string) ([]api.Service, error) {

	url := k.kubeBase + apiBase + "/namespaces/" + pid + "/services?labelSelector=stack%3D" + stack
	request, _ := http.NewRequest("GET", url, nil)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", fmt.Sprintf("Basic %s", k.basicAuth))
	resp, err := k.client.Do(request)
	if err != nil {
		glog.Error(err)
		return nil, err
	} else {
		if resp.StatusCode == http.StatusOK {
			data, err := ioutil.ReadAll(resp.Body)
			if err != nil {
				return nil, err
			}

			serviceList := api.ServiceList{}
			services := make([]api.Service, len(serviceList.Items))
			json.Unmarshal(data, &serviceList)
			for _, service := range serviceList.Items {
				services = append(services, service)
			}
			return services, nil
		} else {
			glog.Warningf("Failed to get Kubernetes services: %s %d", resp.Status, resp.StatusCode)
		}
	}
	return nil, nil
}
func (k *KubeHelper) GetReplicationControllers(pid string, label string, value string) ([]api.ReplicationController, error) {

	url := k.kubeBase + apiBase + "/namespaces/" + pid + "/replicationcontrollers?labelSelector=" + label + "%3D" + value
	request, _ := http.NewRequest("GET", url, nil)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", fmt.Sprintf("Basic %s", k.basicAuth))
	resp, err := k.client.Do(request)
	if err != nil {
		glog.Error(err)
		return nil, err
	} else {
		if resp.StatusCode == http.StatusOK {
			data, err := ioutil.ReadAll(resp.Body)
			if err != nil {
				return nil, err
			}

			rcList := api.ReplicationControllerList{}
			rcs := make([]api.ReplicationController, len(rcList.Items))
			json.Unmarshal(data, &rcList)
			for _, rc := range rcList.Items {
				rcs = append(rcs, rc)
			}
			return rcs, nil
		} else {
			glog.Warningf("Get rcs failed: %s %d", resp.Status, resp.StatusCode)
		}
	}
	return nil, nil
}

func (k *KubeHelper) GetPods(pid string, label string, value string) ([]api.Pod, error) {

	url := k.kubeBase + apiBase + "/namespaces/" + pid + "/pods?labelSelector=" + label + "%3D" + value
	request, _ := http.NewRequest("GET", url, nil)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", fmt.Sprintf("Basic %s", k.basicAuth))
	resp, err := k.client.Do(request)
	if err != nil {
		glog.Error(err)
		return nil, err
	} else {
		if resp.StatusCode == http.StatusOK {
			data, err := ioutil.ReadAll(resp.Body)
			if err != nil {
				return nil, err
			}

			podList := api.PodList{}
			pods := make([]api.Pod, len(podList.Items))
			json.Unmarshal(data, &podList)
			for _, pod := range podList.Items {
				pods = append(pods, pod)
			}
			return pods, nil
		} else {
			glog.Warningf("Get pods failed: %s %d", resp.Status, resp.StatusCode)
		}
	}
	return nil, nil
}

func (k *KubeHelper) StopService(pid string, name string) error {

	url := k.kubeBase + apiBase + "/namespaces/" + pid + "/services/" + name
	request, _ := http.NewRequest("DELETE", url, nil)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", fmt.Sprintf("Basic %s", k.basicAuth))
	httpresp, httperr := k.client.Do(request)
	if httperr != nil {
		glog.Error(httperr)
		return httperr
	} else {
		if httpresp.StatusCode == http.StatusOK {
			glog.V(4).Infof("Deleted service " + name)
			return nil
		} else {
			glog.V(4).Infof("Error stopping service (%d)\n", httpresp.StatusCode)
			return fmt.Errorf("%s", httpresp.Status)
		}
	}
	return nil
}

func (k *KubeHelper) StopController(pid string, name string) error {

	url := k.kubeBase + apiBase + "/namespaces/" + pid + "/replicationcontrollers/" + name
	request, _ := http.NewRequest("DELETE", url, nil)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", fmt.Sprintf("Basic %s", k.basicAuth))
	httpresp, httperr := k.client.Do(request)
	if httperr != nil {
		glog.Error(httperr)
		return httperr
	} else {
		if httpresp.StatusCode == http.StatusOK {
			glog.V(4).Infof("Deleted controller " + name)
		} else {
			glog.V(4).Infof("Error stopping controller (%d)\n", httpresp.StatusCode)
		}
	}
	rcs, _ := k.GetReplicationControllers(pid, "name", name)
	glog.V(4).Infof("Waiting for rc to terminate %s %d\n", name, len(rcs))
	for len(rcs) > 0 {
		rcs, _ = k.GetReplicationControllers(pid, "name", name)
		time.Sleep(time.Second * 1)
	}

	pods, _ := k.GetPods(pid, "name", name)
	for _, pod := range pods {
		err := k.stopPod(pid, pod.Name)
		if err != nil {
			glog.Error(err)
			return err
		}
	}

	pods, _ = k.GetPods(pid, "name", name)
	glog.V(4).Infof("Waiting for pods to terminate %s %d\n", name, len(pods))
	for len(pods) > 0 {
		for _, pod := range pods {
			if len(pod.Status.Conditions) > 0 {
				condition := pod.Status.Conditions[0]
				phase := pod.Status.Phase
				containerState := ""
				if len(pod.Status.ContainerStatuses) > 0 {
					state := pod.Status.ContainerStatuses[0].State
					switch {
					case state.Running != nil:
						containerState = "running"
					case state.Waiting != nil:
						containerState = "waiting"
					case state.Terminated != nil:
						containerState = "terminated"
					}
				}

				glog.V(4).Infof("Waiting for %s (%s=%s) [%s, %s]\n", pod.Name, condition.Type, condition.Status, phase, containerState)
			}
		}
		pods, _ = k.GetPods(pid, "name", name)
		time.Sleep(time.Second * 5)
	}
	return nil
}

func (k *KubeHelper) stopPod(pid string, podName string) error {
	glog.V(4).Infof("Stopping pod %s\n", podName)

	url := k.kubeBase + apiBase + "/namespaces/" + pid + "/pods/" + podName
	request, _ := http.NewRequest("DELETE", url, nil)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", fmt.Sprintf("Basic %s", k.basicAuth))
	httpresp, httperr := k.client.Do(request)
	if httperr != nil {
		glog.Error(httperr)
		return httperr
	} else {
		if httpresp.StatusCode == http.StatusOK {
			glog.V(4).Infof("Deleted pod " + podName)
		} else {
			glog.V(4).Infof("Error stopping pod (%d)\n", httpresp.StatusCode)
			return fmt.Errorf("Error stopping pod (%d)\n", httpresp.StatusCode)
		}
	}
	return nil
}

func (k *KubeHelper) GetLog(pid string, podName string, tailLines int) (string, error) {
	glog.V(4).Infof("Get log for %s %s\n", pid, podName)

	url := k.kubeBase + apiBase + "/namespaces/" + pid + "/pods/" + podName + "/log"

	if tailLines > 0 {
		url += fmt.Sprintf("?tailLines=%d", tailLines)
	}

	glog.V(4).Infoln(url)
	request, _ := http.NewRequest("GET", url, nil)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", fmt.Sprintf("Basic %s", k.basicAuth))
	resp, err := k.client.Do(request)
	if err != nil {
		glog.Error(err)
		return "", err
	} else {
		if resp.StatusCode == http.StatusOK {
			data, err := ioutil.ReadAll(resp.Body)
			if err != nil {
				return "", err
			}
			return string(data), nil
		} else {
			glog.Warningf("Failed to get Kubernetes services: %s %d", resp.Status, resp.StatusCode)
		}
	}
	return "", err
}

func (k *KubeHelper) GetPodsStatus(pid string, selector string) (*map[string]string, error) {

	// Get the pods for this stack
	podStatus := make(map[string]string)
	pods, _ := k.GetPods(pid, "rc", selector)
	for _, pod := range pods {
		label := pod.Labels["name"]
		glog.V(4).Infof("Pod %s %d\n", label, len(pod.Status.Conditions))
		if len(pod.Status.Conditions) > 0 {
			podStatus[label] = string(pod.Status.Phase)
		}
	}
	return &podStatus, nil
}

func (k *KubeHelper) GetServiceEndpoints(pid string, stackKey string) (*map[string]string, error) {

	k8services, _ := k.GetServices(pid, stackKey)
	endpoints := make(map[string]string)
	for _, k8service := range k8services {
		glog.V(4).Infof("Service : %s %s\n", k8service.Name, k8service.Spec.Type)
		if k8service.Spec.Type == "NodePort" {
			glog.V(4).Infof("NodePort : %d\n", k8service.Spec.Ports[0].NodePort)
			endpoints[k8service.GetName()] = fmt.Sprintf("%d", k8service.Spec.Ports[0].NodePort)
		}
	}
	return &endpoints, nil
}

func (k *KubeHelper) generateStackName(stack string, service string, randomLength int) string {
	return fmt.Sprintf("%s-%s-%s", stack, service, utilrand.String(randomLength))
}

func (k *KubeHelper) CreateServiceTemplate(name string, stack string, spec *ndsapi.ServiceSpec) *api.Service {

	// Create the Kubernetes service definition
	k8svc := api.Service{
		TypeMeta: unversioned.TypeMeta{
			APIVersion: "v1",
			Kind:       "Service",
		},
		ObjectMeta: api.ObjectMeta{
			Name: name,
			Labels: map[string]string{
				"name":    name,
				"stack":   stack,
				"service": spec.Key,
			},
		},
		Spec: api.ServiceSpec{
			Selector: map[string]string{
				"name": name,
			},
		},
	}

	if spec.Access == "external" {
		k8svc.Spec.Type = api.ServiceTypeNodePort
	}

	if len(spec.Ports) > 0 {
		for _, port := range spec.Ports {
			k8port := api.ServicePort{
				Name: fmt.Sprintf("%d", port.Port),
				Port: port.Port,
			}
			// For now, assume all ports are TCP
			k8port.Protocol = api.ProtocolTCP
			k8svc.Spec.Ports = append(k8svc.Spec.Ports, k8port)
		}
	}

	return &k8svc
}

func (k *KubeHelper) CreateControllerTemplate(ns string, name string, stack string, stackService *ndsapi.StackService, spec *ndsapi.ServiceSpec, links *map[string]ServiceAddrPort, sharedEnv *map[string]string) *api.ReplicationController {

	k8rc := api.ReplicationController{}
	// Replication controller
	k8rc.APIVersion = "v1"
	k8rc.Kind = "ReplicationController"
	k8rc.Name = name
	k8rc.Labels = map[string]string{
		"name":    name,
		"stack":   stack,
		"service": spec.Key,
	}

	env := []api.EnvVar{}
	env = append(env, api.EnvVar{Name: "NAMESPACE", Value: ns})

	for name, addrPort := range *links {

		if addrPort.NodePort > 0 {
			env = append(env,
				api.EnvVar{
					Name:  fmt.Sprintf("%s_NODE_PORT", strings.ToUpper(name)),
					Value: fmt.Sprintf("%d", addrPort.NodePort),
				})
		}

		if name == spec.Key {
			continue
		}

		env = append(env,
			api.EnvVar{
				Name:  fmt.Sprintf("%s_PORT_%d_TCP_ADDR", strings.ToUpper(name), addrPort.Port),
				Value: addrPort.Host,
			})

		env = append(env,
			api.EnvVar{
				Name:  fmt.Sprintf("%s_PORT_%d_TCP_PORT", strings.ToUpper(name), addrPort.Port),
				Value: fmt.Sprintf("%d", addrPort.Port),
			})
	}

	for _, config := range spec.Config {
		name := config.Name
		value := config.Value
		if config.CanOverride {
			if val, ok := stackService.Config[name]; ok {
				value = val
			}
		}
		env = append(env, api.EnvVar{Name: name, Value: value})
	}

	for name, value := range *sharedEnv {
		env = append(env, api.EnvVar{Name: name, Value: value})
	}

	k8volMounts := []api.VolumeMount{}
	if len(spec.VolumeMounts) > 0 {
		for _, vol := range spec.VolumeMounts {
			k8vol := api.VolumeMount{Name: vol.Name, MountPath: vol.MountPath}
			k8volMounts = append(k8volMounts, k8vol)
		}
	}

	k8cps := []api.ContainerPort{}
	if len(spec.Ports) > 0 {
		for _, port := range spec.Ports {
			k8cp := api.ContainerPort{}
			k8cp.ContainerPort = port.Port
			k8cps = append(k8cps, k8cp)
		}
	}

	k8template := api.PodTemplateSpec{
		ObjectMeta: api.ObjectMeta{
			Labels: map[string]string{
				"name":    name,
				"stack":   stack,
				"service": spec.Key,
			},
		},
		Spec: api.PodSpec{
			Containers: []api.Container{
				api.Container{
					Name:         spec.Key,
					Image:        spec.Image,
					Env:          env,
					VolumeMounts: k8volMounts,
					Ports:        k8cps,
					Args:         spec.Args,
					Command:      spec.Command,
				},
			},
		},
	}

	if spec.ReadyProbe.Path != "" {
		if spec.ReadyProbe.Type == "http" {
			k8probe := &api.Probe{
				Handler: api.Handler{
					HTTPGet: &api.HTTPGetAction{
						Path:   spec.ReadyProbe.Path,
						Port:   intstr.FromInt(spec.ReadyProbe.Port),
						Scheme: api.URISchemeHTTP,
					},
				},
				InitialDelaySeconds: spec.ReadyProbe.InitialDelay,
				TimeoutSeconds:      spec.ReadyProbe.Timeout,
			}
			k8template.Spec.Containers[0].ReadinessProbe = k8probe
		} else if spec.ReadyProbe.Type == "tcp" {
			k8probe := &api.Probe{
				Handler: api.Handler{
					TCPSocket: &api.TCPSocketAction{
						Port: intstr.FromInt(spec.ReadyProbe.Port),
					},
				},
				InitialDelaySeconds: spec.ReadyProbe.InitialDelay,
				TimeoutSeconds:      spec.ReadyProbe.Timeout,
			}
			k8template.Spec.Containers[0].ReadinessProbe = k8probe
		}
	}

	k8rcs := api.ReplicationControllerSpec{
		Replicas: 1,
		Selector: map[string]string{
			"name": name,
		},
		Template: &k8template,
	}

	k8rc.Spec = k8rcs
	return &k8rc
}

/*
func (k *KubeHelper) GenerateName(stack string, service string, randomLength int) string {
	return fmt.Sprintf("%s-%s-%s", stack, service, utilrand.String(randomLength))
}
*/

/*
func (k *KubeHelper) GenerateName(stack string, randomLength int) string {
	return fmt.Sprintf("%s-%s", stack, utilrand.String(randomLength))
}
*/

func (k *KubeHelper) GenerateName(randomLength int) string {
	return fmt.Sprintf("s%s", utilrand.String(randomLength))
}
