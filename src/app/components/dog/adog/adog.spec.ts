import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Adog } from './adog';

describe('Adog', () => {
  let component: Adog;
  let fixture: ComponentFixture<Adog>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Adog],
    }).compileComponents();

    fixture = TestBed.createComponent(Adog);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
