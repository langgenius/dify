package agentcli

import (
	"context"
	"encoding/json"
	"fmt"
)

const agentStubProtocolVersion = 1

// ConnectResponse is the JSON output for `dify-agent connect --json`.
type ConnectResponse struct {
	ConnectionID string `json:"connection_id"`
	Status       string `json:"status"`
}

// RunConnect executes the connect command.
func RunConnect(env *Environment, argv []string, jsonOutput bool) error {
	client, err := NewStubClient(env)
	if err != nil {
		return err
	}
	defer client.Close()

	resp, err := client.Connect(context.Background(), argv, "{}")
	if err != nil {
		return err
	}

	if jsonOutput {
		out, _ := json.Marshal(resp)
		fmt.Println(string(out))
	} else {
		fmt.Printf("connected %s\n", resp.ConnectionID)
	}
	return nil
}
