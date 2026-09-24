package main

import "fmt"

func main() {
	svc := &OrderService{Name: "Checkout"}
	svc.ProcessOrder("ord-123", 99.9)
	fmt.Println("Done")
}
