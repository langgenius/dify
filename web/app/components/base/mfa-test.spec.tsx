import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// Simple test component for debugging
const TestComponent = () => <div>MFA Test Component</div>;

describe('MFA Debug Test', () => {
  test('renders simple component', () => {
    render(<TestComponent />);
    expect(screen.getByText('MFA Test Component')).toBeInTheDocument();
  });
});
