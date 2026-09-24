package main

import "fmt"

type OrderService struct {
	Name string
}

func (s *OrderService) ProcessOrder(orderID string, amount float64) error {
	fmt.Printf("Processing %s: %f\n", orderID, amount)
	ValidateOrder(orderID)
	return nil
}

func ValidateOrder(id string) bool {
	return id != ""
}
